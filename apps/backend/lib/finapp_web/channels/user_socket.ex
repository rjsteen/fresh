defmodule FinappWeb.UserSocket do
  use Phoenix.Socket

  channel "device:*", FinappWeb.DeviceChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Finapp.Guardian.resource_from_token(token) do
      {:ok, user, _claims} ->
        {:ok, assign(socket, :current_user_id, user.id)}

      {:error, reason} ->
        require Logger
        Logger.warning("Socket auth failed: #{inspect(reason)}")
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.current_user_id}"
end
