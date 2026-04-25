defmodule FinappWeb.DeviceControllerTest do
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

  describe "POST /api/v1/devices" do
    test "registers a device and returns device_id", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/devices", %{"name" => "iPhone 15", "platform" => "ios"})

      body = json_response(resp, 201)
      assert is_binary(body["device_id"])

      device = Repo.get(Device, body["device_id"])
      assert device.user_id == user.id
      assert device.name == "iPhone 15"
      assert device.platform == "ios"
    end

    test "registers a device with optional push_token", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/devices", %{
          "name" => "Pixel 8",
          "platform" => "android",
          "push_token" => "fcm-token-abc123"
        })

      body = json_response(resp, 201)
      device = Repo.get(Device, body["device_id"])
      assert device.push_token == "fcm-token-abc123"
    end

    test "defaults name and platform when omitted", %{conn: conn} do
      user = create_user()

      resp = conn |> authed(user) |> post("/api/v1/devices", %{})

      body = json_response(resp, 201)
      device = Repo.get(Device, body["device_id"])
      assert device.name == "Unknown Device"
      assert device.platform == "web"
    end

    test "returns 422 for invalid platform", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/devices", %{"name" => "Tablet", "platform" => "blackberry"})

      assert resp.status == 422
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp = post(conn, "/api/v1/devices", %{"name" => "iPhone", "platform" => "ios"})
      assert resp.status == 401
    end
  end

  describe "DELETE /api/v1/devices/:id" do
    test "deregisters the device and returns ok", %{conn: conn} do
      user = create_user()
      {:ok, device} = Repo.insert(Device.changeset(%Device{}, %{name: "My Phone", platform: "ios", user_id: user.id}))

      resp = conn |> authed(user) |> delete("/api/v1/devices/#{device.id}")

      assert json_response(resp, 200) == %{"ok" => true}
      assert Repo.get(Device, device.id) == nil
    end

    test "returns 404 for another user's device", %{conn: conn} do
      user1 = create_user(%{"email" => "u1@example.com"})
      user2 = create_user(%{"email" => "u2@example.com"})
      {:ok, device} = Repo.insert(Device.changeset(%Device{}, %{name: "Their Phone", platform: "ios", user_id: user2.id}))

      resp = conn |> authed(user1) |> delete("/api/v1/devices/#{device.id}")

      assert json_response(resp, 404) == %{"error" => "not_found"}
      assert Repo.get(Device, device.id) != nil
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp = delete(conn, "/api/v1/devices/some-id")
      assert resp.status == 401
    end
  end

  describe "PUT /api/v1/devices/:id/push-token" do
    test "updates push token and returns ok", %{conn: conn} do
      user = create_user()
      {:ok, device} = Repo.insert(Device.changeset(%Device{}, %{name: "Phone", platform: "ios", user_id: user.id}))

      resp =
        conn
        |> authed(user)
        |> put("/api/v1/devices/#{device.id}/push-token", %{"push_token" => "new-token-xyz"})

      assert json_response(resp, 200) == %{"ok" => true}

      updated = Repo.get(Device, device.id)
      assert updated.push_token == "new-token-xyz"
    end

    test "returns 404 for another user's device", %{conn: conn} do
      user1 = create_user(%{"email" => "u1@example.com"})
      user2 = create_user(%{"email" => "u2@example.com"})
      {:ok, device} = Repo.insert(Device.changeset(%Device{}, %{name: "Their Phone", platform: "ios", user_id: user2.id}))

      resp =
        conn
        |> authed(user1)
        |> put("/api/v1/devices/#{device.id}/push-token", %{"push_token" => "stolen"})

      assert json_response(resp, 404) == %{"error" => "not_found"}
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp = put(conn, "/api/v1/devices/some-id/push-token", %{"push_token" => "tok"})
      assert resp.status == 401
    end
  end
end
