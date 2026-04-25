defmodule FinappWeb.AuthControllerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.User

  defp create_user(attrs \\ %{}) do
    attrs = Map.merge(%{"email" => "test@example.com", "password" => "password123"}, attrs)
    Repo.insert!(User.registration_changeset(%User{}, attrs))
  end

  describe "POST /api/v1/auth/register" do
    test "returns tokens and user_id on success", %{conn: conn} do
      resp =
        post(conn, "/api/v1/auth/register", %{
          "email" => "new@example.com",
          "password" => "password123"
        })

      body = json_response(resp, 200)
      assert is_binary(body["token"])
      assert is_binary(body["refresh_token"])
      assert is_binary(body["user_id"])
    end

    test "writes the user to the database", %{conn: conn} do
      post(conn, "/api/v1/auth/register", %{
        "email" => "persisted@example.com",
        "password" => "password123"
      })

      user = Repo.get_by(User, email: "persisted@example.com")
      assert user != nil
      assert Bcrypt.verify_pass("password123", user.password_hash)
    end

    test "returns 422 for duplicate email", %{conn: conn} do
      create_user(%{"email" => "dup@example.com"})

      resp =
        post(conn, "/api/v1/auth/register", %{
          "email" => "dup@example.com",
          "password" => "password123"
        })

      assert resp.status == 422
      assert get_in(json_response(resp, 422), ["errors", "email"]) != nil
    end

    test "returns 422 for invalid email format", %{conn: conn} do
      resp =
        post(conn, "/api/v1/auth/register", %{
          "email" => "not-an-email",
          "password" => "password123"
        })

      assert resp.status == 422
      assert get_in(json_response(resp, 422), ["errors", "email"]) != nil
    end

    test "does not store plaintext password", %{conn: conn} do
      post(conn, "/api/v1/auth/register", %{
        "email" => "safe@example.com",
        "password" => "password123"
      })

      user = Repo.get_by(User, email: "safe@example.com")
      refute user.password_hash == "password123"
    end
  end

  describe "POST /api/v1/auth/login" do
    test "returns tokens for valid credentials", %{conn: conn} do
      create_user(%{"email" => "login@example.com"})

      resp =
        post(conn, "/api/v1/auth/login", %{
          "email" => "login@example.com",
          "password" => "password123"
        })

      body = json_response(resp, 200)
      assert is_binary(body["token"])
      assert is_binary(body["refresh_token"])
      assert is_binary(body["user_id"])
    end

    test "returns 401 for wrong password", %{conn: conn} do
      create_user(%{"email" => "login@example.com"})

      resp =
        post(conn, "/api/v1/auth/login", %{
          "email" => "login@example.com",
          "password" => "wrongpassword"
        })

      assert json_response(resp, 401) == %{"error" => "invalid_credentials"}
    end

    test "returns 401 for non-existent email", %{conn: conn} do
      resp =
        post(conn, "/api/v1/auth/login", %{
          "email" => "nobody@example.com",
          "password" => "password123"
        })

      assert json_response(resp, 401) == %{"error" => "invalid_credentials"}
    end

    test "response is same shape for wrong password vs non-existent user (prevents email enumeration)",
         %{conn: conn} do
      create_user(%{"email" => "existing@example.com"})

      wrong_pass =
        post(conn, "/api/v1/auth/login", %{
          "email" => "existing@example.com",
          "password" => "wrongpassword"
        })

      no_user =
        post(conn, "/api/v1/auth/login", %{
          "email" => "nobody@example.com",
          "password" => "wrongpassword"
        })

      assert wrong_pass.status == no_user.status
      assert json_response(wrong_pass, 401) == json_response(no_user, 401)
    end
  end

  describe "POST /api/v1/auth/refresh" do
    test "returns a new access token for a valid refresh token", %{conn: conn} do
      user = create_user()
      {:ok, refresh, _claims} = Finapp.Guardian.build_refresh_token(user)

      resp = post(conn, "/api/v1/auth/refresh", %{"refresh_token" => refresh})

      body = json_response(resp, 200)
      assert is_binary(body["token"])
    end

    test "returns 401 for a garbage token", %{conn: conn} do
      resp = post(conn, "/api/v1/auth/refresh", %{"refresh_token" => "not.a.valid.token"})
      assert resp.status == 401
    end

    test "returns 401 when an access token is used as a refresh token", %{conn: conn} do
      user = create_user()
      {:ok, access_token, _claims} = Finapp.Guardian.build_token(user)

      resp = post(conn, "/api/v1/auth/refresh", %{"refresh_token" => access_token})
      assert resp.status == 401
    end
  end
end
