defmodule FinappWeb.UserController do
  use Phoenix.Controller, formats: [:json]

  alias Finapp.{Accounts, Guardian}

  def update(conn, params) do
    user = Guardian.Plug.current_resource(conn)

    case Accounts.update_user(user, params) do
      {:ok, updated} ->
        json(conn, %{
          id: updated.id,
          email: updated.email,
          timezone: updated.timezone,
          region: updated.region
        })

      {:error, :invalid_password} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid_password"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

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

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
