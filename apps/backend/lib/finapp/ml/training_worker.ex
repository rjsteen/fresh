defmodule Finapp.ML.TrainingWorker do
  @moduledoc """
  Oban worker that forwards accumulated training examples to the ML sidecar,
  then triggers a training run when the sidecar has enough data.

  Runs every 6 hours via cron. The sidecar accumulates feature vectors in memory
  across calls; once it has ≥ 10, it will train a new model and upload it to R2.

  Training examples are only marked exported after a successful /train response.
  This means examples are re-sent on each worker run until training completes,
  which handles sidecar restarts gracefully at the cost of some duplicate data.
  """

  use Oban.Worker, queue: :ml_training, max_attempts: 3

  require Logger

  import Ecto.Query

  alias Finapp.ML.{SidecarClient, TrainingExample}
  alias Finapp.Repo

  @impl Oban.Worker
  def perform(_job) do
    fetch_unexported()
    |> Enum.group_by(& &1.model_type)
    |> Enum.reduce_while(:ok, &sync_or_halt/2)
  end

  defp sync_or_halt({model_type, examples}, _acc) do
    case sync_model_type(model_type, examples) do
      :ok -> {:cont, :ok}
      {:error, _} = err -> {:halt, err}
    end
  end

  defp sync_model_type(model_type, examples) do
    with :ok <- SidecarClient.post_training_data(model_type, examples) do
      category_ids = fetch_category_ids(model_type)

      case SidecarClient.trigger_training(model_type, category_ids) do
        {:ok, result} ->
          mark_exported(Enum.map(examples, & &1.id))

          Logger.info("[TrainingWorker] training complete for #{model_type}",
            version: result["version"],
            num_examples: result["num_examples"],
            num_classes: result["num_classes"]
          )

          :ok

        {:error, :not_enough_data} ->
          Logger.info("[TrainingWorker] not enough data yet for #{model_type}, will accumulate more")
          :ok

        {:error, reason} ->
          Logger.error("[TrainingWorker] training failed for #{model_type}",
            reason: inspect(reason)
          )
          {:error, reason}
      end
    end
  end

  defp fetch_unexported do
    Repo.all(
      from e in TrainingExample,
        where: is_nil(e.exported_at),
        order_by: [asc: e.inserted_at]
    )
  end

  defp fetch_category_ids(model_type) do
    Repo.all(
      from e in TrainingExample,
        where: e.model_type == ^model_type,
        select: e.label,
        distinct: true
    )
  end

  defp mark_exported(ids) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.update_all(
      from(e in TrainingExample, where: e.id in ^ids),
      set: [exported_at: now]
    )
  end
end
