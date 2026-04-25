defmodule FinappWeb.DeviceChannelTest do
  use FinappWeb.ChannelCase

  alias Finapp.Accounts.{Device, User}
  alias Finapp.Sync.SyncJob

  defp create_user(email \\ "channel@example.com") do
    Repo.insert!(User.registration_changeset(%User{}, %{"email" => email, "password" => "password123"}))
  end

  defp connect_socket(user) do
    {:ok, token, _} = Finapp.Guardian.build_token(user)
    connect(FinappWeb.UserSocket, %{"token" => token})
  end

  defp insert_device(user) do
    Repo.insert!(Device.changeset(%Device{}, %{name: "Test Phone", platform: "ios", user_id: user.id}))
  end

  defp insert_sync_job(user) do
    {:ok, encrypted} = Finapp.Vault.encrypt("https://user:s@bridge.simplefin.org/simplefin")

    Repo.insert!(%SyncJob{
      user_id: user.id,
      account_token_ref: "ref-ch-#{System.unique_integer([:positive])}",
      connection_type: "simplefin",
      encrypted_access_url_ref: encrypted
    })
  end

  describe "connect/3" do
    test "accepts connection with a valid JWT" do
      user = create_user()
      assert {:ok, _socket} = connect_socket(user)
    end

    test "rejects connection with an invalid token" do
      assert :error = connect(FinappWeb.UserSocket, %{"token" => "bad.token.here"})
    end

    test "rejects connection when token param is absent" do
      assert :error = connect(FinappWeb.UserSocket, %{})
    end

    test "assigns current_user_id on the socket" do
      user = create_user("socket-id@example.com")
      {:ok, socket} = connect_socket(user)
      assert socket.assigns.current_user_id == user.id
    end
  end

  describe "join device:me" do
    test "returns connected status", %{} do
      user = create_user("join@example.com")
      {:ok, socket} = connect_socket(user)

      assert {:ok, reply, _socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      Process.sleep(50)
      assert reply == %{status: "connected"}
    end

    test "relays PubSub messages to the client after join" do
      user = create_user("pubsub-join@example.com")
      {:ok, socket} = connect_socket(user)
      {:ok, _, _socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      Process.sleep(50)

      Phoenix.PubSub.broadcast(Finapp.PubSub, "user:#{user.id}", {:account_deleted, %{}})
      assert_push "account:deleted", %{}, 500
    end
  end

  describe "handle_in sync:ack" do
    test "updates last_synced_at on the matching sync job" do
      user = create_user("sync-ack@example.com")
      job = insert_sync_job(user)

      {:ok, socket} = connect_socket(user)
      {:ok, _, socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      Process.sleep(50)

      push(socket, "sync:ack", %{"account_token_ref" => job.account_token_ref})
      Process.sleep(100)

      updated = Repo.get(SyncJob, job.id)
      assert updated.last_synced_at != nil
    end

    test "ignores unknown account_token_ref without crashing" do
      user = create_user("ack-unknown@example.com")

      {:ok, socket} = connect_socket(user)
      {:ok, _, socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      Process.sleep(50)

      assert push(socket, "sync:ack", %{"account_token_ref" => "nonexistent-ref"})
    end
  end

  describe "handle_in alert:register / alert:deregister" do
    test "alert:register adds the token ref to the device" do
      user = create_user("alert-reg@example.com")
      insert_device(user)

      {:ok, socket} = connect_socket(user)
      {:ok, _, socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      Process.sleep(50)

      push(socket, "alert:register", %{"rule_token_ref" => "rule-ref-abc"})
      Process.sleep(100)

      device = Repo.one(from d in Device, where: d.user_id == ^user.id)
      assert "rule-ref-abc" in device.alert_token_refs
    end

    test "alert:deregister removes the token ref from the device" do
      user = create_user("alert-dereg@example.com")
      device = insert_device(user)

      # Seed with an existing ref
      device
      |> Device.changeset(%{alert_token_refs: ["rule-ref-xyz"]})
      |> Repo.update!()

      {:ok, socket} = connect_socket(user)
      {:ok, _, socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      Process.sleep(50)

      push(socket, "alert:deregister", %{"rule_token_ref" => "rule-ref-xyz"})
      Process.sleep(100)

      updated = Repo.one(from d in Device, where: d.user_id == ^user.id)
      refute "rule-ref-xyz" in updated.alert_token_refs
    end
  end

  describe "PubSub → channel bridge" do
    setup do
      user = create_user("bridge@example.com")
      {:ok, socket} = connect_socket(user)
      {:ok, _, socket} = subscribe_and_join(socket, FinappWeb.DeviceChannel, "device:me")
      # Wait for touch_device Task.start to finish before test assertions run
      Process.sleep(50)
      {:ok, socket: socket, user: user}
    end

    test "pushes sync:complete to the client", %{user: user} do
      payload = %{account_token_ref: "ref-1", transaction_count: 3, cursor: "2026-04-01",
                  encrypted_transactions: %{ciphertext: "abc", iv: "def", tag: "ghi"}}

      Phoenix.PubSub.broadcast(Finapp.PubSub, "user:#{user.id}", {:sync_complete, payload})

      assert_push "sync:complete", ^payload, 500
    end

    test "pushes sync:error to the client", %{user: user} do
      payload = %{account_token_ref: "ref-1", reason: "connection_expired"}

      Phoenix.PubSub.broadcast(Finapp.PubSub, "user:#{user.id}", {:sync_error, payload})

      assert_push "sync:error", ^payload, 500
    end

    test "pushes model:updated to the client", %{user: user} do
      payload = %{model_type: "categorizer", version: "2.0.0",
                  cdn_path: "models/cat/2.0.0/model.onnx", checksum_sha256: "abc123"}

      Phoenix.PubSub.broadcast(Finapp.PubSub, "user:#{user.id}", {:model_updated, payload})

      assert_push "model:updated", ^payload, 500
    end

    test "pushes account:deleted to the client", %{user: user} do
      Phoenix.PubSub.broadcast(Finapp.PubSub, "user:#{user.id}", {:account_deleted, %{}})

      assert_push "account:deleted", %{}, 500
    end
  end
end
