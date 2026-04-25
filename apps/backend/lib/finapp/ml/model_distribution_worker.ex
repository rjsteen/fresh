defmodule Finapp.ML.ModelDistributionWorker do
  @moduledoc """
  Oban worker that checks if a new model version has been deployed to CDN
  and broadcasts model:updated signals to all connected devices.

  Called on a schedule (every 6h) AND triggered directly by the ML sidecar
  via the internal /internal/models/notify endpoint.
  """

  use Oban.Worker, queue: :model_dist, max_attempts: 3

  alias Finapp.{Accounts.Device, Notifications.PushWorker, Repo}
  import Ecto.Query

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"model_type" => model_type, "version" => version,
                                "cdn_path" => cdn_path, "checksum_sha256" => checksum}}) do
    broadcast_model_update(model_type, version, cdn_path, checksum)
    :ok
  end

  # Called by the cron schedule — check for any pending model updates
  def perform(%Oban.Job{}) do
    current_models = get_current_model_versions()
    for model <- current_models do
      broadcast_model_update(model.model_type, model.version, model.cdn_path, model.checksum_sha256)
    end
    :ok
  end

  defp broadcast_model_update(model_type, version, cdn_path, checksum) do
    payload = %{
      model_type: model_type,
      version: version,
      cdn_path: cdn_path,
      checksum_sha256: checksum
    }

    # Broadcast to all connected users via PubSub
    # Each user's DeviceChannel will push the signal to their connected devices
    Phoenix.PubSub.broadcast(Finapp.PubSub, "model_updates", {:model_updated, payload})

    enqueue_model_pushes(model_type, version)
  end

  defp enqueue_model_pushes(model_type, version) do
    user_ids =
      Repo.all(
        from d in Device,
          where: not is_nil(d.push_token),
          select: d.user_id,
          distinct: true
      )

    changesets =
      Enum.map(user_ids, fn user_id ->
        PushWorker.new(%{
          "user_id" => user_id,
          "title" => "Model updated",
          "body" => "New #{model_type} v#{version} is available.",
          "data" => %{"event" => "model:updated", "model_type" => model_type, "version" => version}
        })
      end)

    Oban.insert_all(changesets)
    :ok
  end

  defp get_current_model_versions do
    Repo.all(
      from mv in "model_versions",
        where: mv.is_current == true,
        select: %{
          model_type: mv.model_type,
          version: mv.version,
          cdn_path: mv.cdn_path,
          checksum_sha256: mv.checksum_sha256
        }
    )
  end
end
