defmodule Finapp.Notifications.PushDispatcher do
  @moduledoc """
  Delivers push notifications to mobile devices via the Expo Push API.
  https://docs.expo.dev/push-notifications/sending-notifications/

  Only dispatches to Expo push tokens (ExponentPushToken[...]) — legacy
  FCM/APNs tokens not obtained through Expo SDK are silently skipped.

  Handles `DeviceNotRegistered` error tickets by clearing the stale token
  from the DB so future jobs don't attempt it again.
  """

  import Ecto.Query
  alias Finapp.{Accounts.Device, Repo}

  @expo_push_url "https://exp.host/--/api/v2/push/send"
  # Expo accepts up to 100 messages per request
  @batch_size 100

  @doc """
  Send a push notification to the given Expo push tokens.

  `notification` must contain `:title` (string) and `:body` (string) keys.
  Optional `:data` (map) is forwarded to the app's notification handler.

  Returns `:ok`, or `{:error, reason}` on a transport or HTTP-level failure.
  Individual per-token errors (e.g. `DeviceNotRegistered`) are handled
  internally and do not cause this function to return an error.
  """
  def push([], _notification), do: :ok

  def push(tokens, notification) when is_list(tokens) do
    tokens
    |> Enum.filter(&expo_token?/1)
    |> Enum.chunk_every(@batch_size)
    |> Enum.reduce_while(:ok, fn batch, :ok ->
      case send_batch(batch, notification) do
        :ok -> {:cont, :ok}
        err -> {:halt, err}
      end
    end)
  end

  # --- Private ---

  defp send_batch(tokens, notification) do
    messages =
      Enum.map(tokens, fn token ->
        %{
          to: token,
          title: notification.title,
          body: notification.body,
          data: Map.get(notification, :data, %{}),
          sound: "default"
        }
      end)

    case req_post(messages) do
      {:ok, %{status: 200, body: %{"data" => results}}} ->
        handle_tickets(tokens, results)
        :ok

      {:ok, %{status: status}} ->
        {:error, {:http_error, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp handle_tickets(tokens, results) do
    tokens
    |> Enum.zip(results)
    |> Enum.each(fn {token, result} -> handle_ticket(token, result) end)
  end

  defp handle_ticket(token, %{"status" => "error", "details" => %{"error" => "DeviceNotRegistered"}}) do
    clear_push_token(token)
  end

  defp handle_ticket(_token, _result), do: :ok

  defp clear_push_token(token) do
    Repo.update_all(
      from(d in Device, where: d.push_token == ^token),
      set: [push_token: nil]
    )
  end

  defp expo_token?("ExponentPushToken[" <> _), do: true
  defp expo_token?(_), do: false

  defp req_post(messages) do
    opts = [json: messages, retry: false]

    case req_plug() do
      nil -> Req.post(@expo_push_url, opts)
      plug -> Req.post(@expo_push_url, Keyword.put(opts, :plug, plug))
    end
  end

  defp req_plug, do: Application.get_env(:finapp, __MODULE__, [])[:req_plug]
end
