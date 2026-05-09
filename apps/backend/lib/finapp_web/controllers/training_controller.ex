defmodule FinappWeb.TrainingController do
  use Phoenix.Controller, formats: [:json]

  alias Finapp.ML.TrainingExample
  alias Finapp.Repo

  @max_batch_size 500
  @input_dim 100

  def submit(conn, params) do
    with {:ok, model_type} <- validate_model_type(params["model_type"]),
         {:ok, examples} <- validate_examples(params["examples"]) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      rows =
        Enum.map(examples, fn e ->
          %{
            id: Ecto.UUID.generate(),
            model_type: model_type,
            features: e["features"],
            label: e["label"],
            inserted_at: now,
            updated_at: now
          }
        end)

      Repo.insert_all(TrainingExample, rows)

      send_resp(conn, 204, "")
    else
      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  defp validate_model_type(t) when t in ["categorizer", "anomaly"], do: {:ok, t}
  defp validate_model_type(_), do: {:error, "model_type must be 'categorizer' or 'anomaly'"}

  defp validate_examples(nil), do: {:error, "examples is required"}
  defp validate_examples([]), do: {:error, "examples must not be empty"}

  defp validate_examples(examples) when length(examples) > @max_batch_size,
    do: {:error, "batch size exceeds maximum of #{@max_batch_size}"}

  defp validate_examples(examples) when is_list(examples) do
    Enum.reduce_while(examples, {:ok, examples}, fn e, acc ->
      features = e["features"]
      label = e["label"]

      cond do
        not is_list(features) or length(features) != @input_dim ->
          {:halt, {:error, "each example must have exactly #{@input_dim} features"}}

        not is_binary(label) or String.trim(label) == "" ->
          {:halt, {:error, "each example must have a non-empty label"}}

        true ->
          {:cont, acc}
      end
    end)
  end

  defp validate_examples(_), do: {:error, "examples must be a list"}
end
