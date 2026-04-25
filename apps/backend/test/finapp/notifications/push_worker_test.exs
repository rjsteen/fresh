defmodule Finapp.Notifications.PushWorkerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.{Device, User}
  alias Finapp.Notifications.PushWorker

  defp create_user(email \\ "push@example.com") do
    Repo.insert!(User.registration_changeset(%User{}, %{"email" => email, "password" => "password123"}))
  end

  defp insert_device(user, attrs \\ %{}) do
    defaults = %{name: "iPhone", platform: "ios", user_id: user.id}
    Repo.insert!(Device.changeset(%Device{}, Map.merge(defaults, attrs)))
  end

  defp expo_stub(fun), do: Req.Test.stub(Finapp.Notifications.PushDispatcher, fun)

  defp json_resp(conn, body) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(200, Jason.encode!(body))
  end

  defp perform(args) do
    PushWorker.perform(%Oban.Job{args: args})
  end

  describe "perform/1 — user has devices with push tokens" do
    test "posts tokens to the Expo API and returns :ok", %{conn: _conn} do
      user = create_user()
      insert_device(user, %{push_token: "ExponentPushToken[test-token-1]"})
      insert_device(user, %{push_token: "ExponentPushToken[test-token-2]"})

      test_pid = self()

      expo_stub(fn conn ->
        {:ok, body, conn} = Plug.Conn.read_body(conn)
        send(test_pid, {:expo_request, Jason.decode!(body)})
        json_resp(conn, %{"data" => [%{"status" => "ok"}, %{"status" => "ok"}]})
      end)

      assert :ok =
               perform(%{
                 "user_id" => user.id,
                 "title" => "Test notification",
                 "body" => "Hello!"
               })

      assert_receive {:expo_request, messages}
      tokens = Enum.map(messages, & &1["to"])
      assert "ExponentPushToken[test-token-1]" in tokens
      assert "ExponentPushToken[test-token-2]" in tokens

      assert Enum.all?(messages, &(&1["title"] == "Test notification"))
      assert Enum.all?(messages, &(&1["body"] == "Hello!"))
    end

    test "forwards data payload to Expo", %{conn: _conn} do
      user = create_user("data@example.com")
      insert_device(user, %{push_token: "ExponentPushToken[tok]"})

      test_pid = self()

      expo_stub(fn conn ->
        {:ok, body, conn} = Plug.Conn.read_body(conn)
        send(test_pid, {:expo_request, Jason.decode!(body)})
        json_resp(conn, %{"data" => [%{"status" => "ok"}]})
      end)

      assert :ok =
               perform(%{
                 "user_id" => user.id,
                 "title" => "Sync",
                 "body" => "Done",
                 "data" => %{"event" => "sync:complete"}
               })

      assert_receive {:expo_request, [message]}
      assert message["data"]["event"] == "sync:complete"
    end

    test "clears stale token when Expo returns DeviceNotRegistered", %{conn: _conn} do
      user = create_user("stale@example.com")
      device = insert_device(user, %{push_token: "ExponentPushToken[stale-token]"})

      expo_stub(fn conn ->
        json_resp(conn, %{
          "data" => [
            %{"status" => "error", "details" => %{"error" => "DeviceNotRegistered"}}
          ]
        })
      end)

      assert :ok =
               perform(%{"user_id" => user.id, "title" => "Hi", "body" => "There"})

      updated = Repo.get(Device, device.id)
      assert updated.push_token == nil
    end
  end

  describe "perform/1 — user has no devices with push tokens" do
    test "returns :ok without calling the Expo API", %{conn: _conn} do
      user = create_user("notoken@example.com")
      insert_device(user, %{push_token: nil})

      # No stub registered — if the Expo API were called it would raise
      assert :ok = perform(%{"user_id" => user.id, "title" => "Hi", "body" => "There"})
    end

    test "returns :ok for a user with no devices at all", %{conn: _conn} do
      user = create_user("nodevice@example.com")

      assert :ok = perform(%{"user_id" => user.id, "title" => "Hi", "body" => "There"})
    end
  end

  describe "perform/1 — Expo API failure" do
    test "returns {:error, reason} on non-200 response", %{conn: _conn} do
      user = create_user("err@example.com")
      insert_device(user, %{push_token: "ExponentPushToken[tok]"})

      expo_stub(fn conn ->
        Plug.Conn.send_resp(conn, 500, "")
      end)

      assert {:error, {:http_error, 500}} =
               perform(%{"user_id" => user.id, "title" => "Hi", "body" => "There"})
    end
  end
end
