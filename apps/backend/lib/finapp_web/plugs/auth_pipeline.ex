defmodule FinappWeb.Plugs.AuthPipeline do
  use Guardian.Plug.Pipeline,
    otp_app: :finapp,
    module: Finapp.Guardian,
    error_handler: FinappWeb.Plugs.AuthErrorHandler

  plug Guardian.Plug.VerifyHeader, scheme: "Bearer"
  plug Guardian.Plug.EnsureAuthenticated
  plug Guardian.Plug.LoadResource
end

defmodule FinappWeb.Plugs.AuthErrorHandler do
  import Plug.Conn
  import Phoenix.Controller

  def auth_error(conn, {type, _reason}, _opts) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: to_string(type)})
    |> halt()
  end
end
