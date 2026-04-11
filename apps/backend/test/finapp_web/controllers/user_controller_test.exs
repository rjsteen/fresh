defmodule FinappWeb.UserControllerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.{Device, User}

  defp create_user(attrs \\ %{}) do
    attrs = Map.merge(%{"email" => "test@example.com", "password" => "password123"}, attrs)
    Repo.insert!(User.registration_changeset(%User{}, attrs))
  end

  defp authed(conn, user) do
    {:ok, token, _claims} = Finapp.Guardian.build_token(user)
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  describe "PATCH /api/v1/users/me" do
    test "updates timezone and region", %{conn: conn} do
      user = create_user(%{"region" => "us", "timezone" => "UTC"})

      resp =
        conn
        |> authed(user)
        |> patch("/api/v1/users/me", %{"timezone" => "America/New_York", "region" => "eu"})

      assert resp.status == 200
      body = json_response(resp, 200)
      assert body["timezone"] == "America/New_York"
      assert body["region"] == "eu"
      assert Map.has_key?(body, "password_hash") == false

      updated = Repo.get(User, user.id)
      assert updated.timezone == "America/New_York"
      assert updated.region == "eu"
    end

    test "updates password when current_password is correct", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> patch("/api/v1/users/me", %{
          "current_password" => "password123",
          "new_password" => "newpass456"
        })

      assert resp.status == 200

      updated = Repo.get(User, user.id)
      assert Bcrypt.verify_pass("newpass456", updated.password_hash)
    end

    test "returns 401 when current_password is wrong", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> patch("/api/v1/users/me", %{
          "current_password" => "wrongpass",
          "new_password" => "newpass456"
        })

      assert json_response(resp, 401) == %{"error" => "invalid_password"}

      unchanged = Repo.get(User, user.id)
      assert Bcrypt.verify_pass("password123", unchanged.password_hash)
    end

    test "returns 401 when new_password given but current_password is missing", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> patch("/api/v1/users/me", %{"new_password" => "newpass456"})

      assert json_response(resp, 401) == %{"error" => "invalid_password"}
    end

    test "returns 422 for invalid region", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> patch("/api/v1/users/me", %{"region" => "au"})

      assert resp.status == 422
      body = json_response(resp, 422)
      assert Map.has_key?(body, "errors")
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp = patch(conn, "/api/v1/users/me", %{"timezone" => "UTC"})
      assert resp.status == 401
    end
  end

  describe "DELETE /api/v1/users/me" do
    test "returns 204 and deletes the user with correct password", %{conn: conn} do
      user = create_user()
      resp = conn |> authed(user) |> delete("/api/v1/users/me", %{"password" => "password123"})
      assert resp.status == 204
      assert Repo.get(User, user.id) == nil
    end

    test "cascade-deletes devices when user is deleted", %{conn: conn} do
      user = create_user()
      Repo.insert!(%Device{user_id: user.id, name: "My Phone", platform: "ios"})

      conn |> authed(user) |> delete("/api/v1/users/me", %{"password" => "password123"})

      assert Repo.all(from d in Device, where: d.user_id == ^user.id) == []
    end

    test "broadcasts account:deleted to PubSub before deletion", %{conn: conn} do
      user = create_user()
      Phoenix.PubSub.subscribe(Finapp.PubSub, "user:#{user.id}")

      conn |> authed(user) |> delete("/api/v1/users/me", %{"password" => "password123"})

      assert_receive {:account_deleted, %{}}
    end

    test "returns 401 with wrong password", %{conn: conn} do
      user = create_user()
      resp = conn |> authed(user) |> delete("/api/v1/users/me", %{"password" => "wrongpass"})
      assert json_response(resp, 401) == %{"error" => "invalid_password"}
    end

    test "does not delete user when wrong password given", %{conn: conn} do
      user = create_user()
      conn |> authed(user) |> delete("/api/v1/users/me", %{"password" => "wrongpass"})
      assert Repo.get(User, user.id) != nil
    end

    test "returns 422 when password is missing", %{conn: conn} do
      user = create_user()
      resp = conn |> authed(user) |> delete("/api/v1/users/me", %{})
      assert json_response(resp, 422) == %{"error" => "password_required"}
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp = delete(conn, "/api/v1/users/me", %{"password" => "password123"})
      assert resp.status == 401
    end
  end
end
