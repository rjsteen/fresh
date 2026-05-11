defmodule Finapp.ML.SidecarClient do
  @moduledoc """
  HTTP client for the internal ML sidecar service.

  Sends anonymized feature vectors for training and triggers model training runs.
  Authentication uses the shared SIDECAR_TOKEN as a Bearer credential.
  """

  require Logger

  def post_training_data(model_type, examples) do
    body = %{
      model_type: model_type,
      examples: Enum.map(examples, fn e -> %{features: e.features, label: e.label} end)
    }

    case do_post("/training-data", json: body) do
      {:ok, %{status: 204}} ->
        :ok

      {:ok, %{status: status, body: resp_body}} ->
        Logger.warning("[SidecarClient] POST /training-data returned #{status} for #{model_type}: #{inspect(resp_body)}")
        {:error, {:http_error, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def trigger_training(model_type, category_ids) do
    body = %{model_type: model_type, category_ids: category_ids}

    case do_post("/train", json: body) do
      {:ok, %{status: 200, body: resp_body}} ->
        {:ok, resp_body}

      {:ok, %{status: 400, body: %{"detail" => msg}}} when is_binary(msg) ->
        if String.contains?(msg, "Need at least") do
          {:error, :not_enough_data}
        else
          {:error, {:http_error, 400, msg}}
        end

      {:ok, %{status: status, body: resp_body}} ->
        Logger.warning("[SidecarClient] POST /train returned #{status} for #{model_type}: #{inspect(resp_body)}")
        {:error, {:http_error, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_post(path, opts) do
    base_url = Application.fetch_env!(:finapp, :ml_sidecar_url)
    token = Application.fetch_env!(:finapp, :sidecar_token)

    req_opts = Keyword.merge(
      [base_url: base_url, auth: {:bearer, token}, retry: false, receive_timeout: 60_000],
      opts
    )

    case req_plug() do
      nil -> Req.post(path, req_opts)
      plug -> Req.post(path, Keyword.put(req_opts, :plug, plug))
    end
  end

  defp req_plug, do: Application.get_env(:finapp, __MODULE__, [])[:req_plug]
end
