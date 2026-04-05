defmodule FinappWeb.AuthController do
  use Phoenix.Controller, formats: [:json]
  import Ecto.Query

  alias Finapp.{Repo, Guardian}
  alias Finapp.Accounts.User

  def register(conn, %{"email" => _email, "password" => _password} = params) do
    changeset = User.registration_changeset(%User{}, params)

    case Repo.insert(changeset) do
      {:ok, user} ->
        {:ok, token, _claims} = Guardian.build_token(user)
        {:ok, refresh, _claims} = Guardian.build_refresh_token(user)
        json(conn, %{token: token, refresh_token: refresh, user_id: user.id})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def login(conn, %{"email" => email, "password" => password}) do
    user = Repo.one(from u in User, where: u.email == ^email)

    case authenticate(user, password) do
      {:ok, user} ->
        {:ok, token, _claims} = Guardian.build_token(user)
        {:ok, refresh, _claims} = Guardian.build_refresh_token(user)
        json(conn, %{token: token, refresh_token: refresh, user_id: user.id})

      :error ->
        # Constant-time response to prevent email enumeration
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid_credentials"})
    end
  end

  def refresh(conn, %{"refresh_token" => refresh_token}) do
    case Guardian.exchange(refresh_token, "refresh", "access") do
      {:ok, _old, {new_token, _claims}} ->
        json(conn, %{token: new_token})

      {:error, reason} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: to_string(reason)})
    end
  end

  defp authenticate(nil, _password) do
    # Always run the hash to prevent timing attacks
    Bcrypt.no_user_verify()
    :error
  end

  defp authenticate(user, password) do
    if Bcrypt.verify_pass(password, user.password_hash) do
      {:ok, user}
    else
      :error
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
