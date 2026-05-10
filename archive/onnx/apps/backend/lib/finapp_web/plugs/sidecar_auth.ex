defmodule FinappWeb.Plugs.SidecarAuth do
  @moduledoc """
  Validates the X-Internal-Token header on internal sidecar endpoints.
  Returns 401 if the header is missing or does not match the configured SIDECAR_TOKEN.
  """

  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(conn, _opts) do
    expected = Application.get_env(:finapp, :sidecar_token)

    case get_req_header(conn, "x-internal-token") do
      [^expected] ->
        conn

      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "unauthorized"})
        |> halt()
    end
  end
end
