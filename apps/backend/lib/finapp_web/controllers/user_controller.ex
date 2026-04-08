defmodule FinappWeb.UserController do
  use Phoenix.Controller, formats: [:json]

  alias Finapp.{Accounts, Guardian}

  def delete(conn, %{"password" => password}) do
    user = Guardian.Plug.current_resource(conn)

    case Accounts.delete_user(user, password) do
      {:ok, _} ->
        send_resp(conn, :no_content, "")

      {:error, :invalid_password} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid_password"})
    end
  end

  def delete(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "password_required"})
  end
end
