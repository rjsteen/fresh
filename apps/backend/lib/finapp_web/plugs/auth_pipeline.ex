defmodule FinappWeb.Plugs.AuthPipeline do
  @moduledoc false

  use Guardian.Plug.Pipeline,
    otp_app: :finapp,
    module: Finapp.Guardian,
    error_handler: FinappWeb.Plugs.AuthErrorHandler

  plug Guardian.Plug.VerifyHeader, scheme: "Bearer"
  plug Guardian.Plug.EnsureAuthenticated
  plug Guardian.Plug.LoadResource
end

defmodule FinappWeb.Plugs.AuthErrorHandler do
  @moduledoc false

  import Plug.Conn
  import Phoenix.Controller

  def auth_error(conn, {type, _reason}, _opts) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: to_string(type)})
    |> halt()
  end
end
