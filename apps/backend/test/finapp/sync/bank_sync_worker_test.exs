defmodule Finapp.Sync.BankSyncWorkerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.User
  alias Finapp.Sync.{BankSyncWorker, SyncJob}

  @access_url "https://user:secret@bridge.simplefin.org/simplefin"

  defp create_user(email \\ "worker@example.com") do
    Repo.insert!(User.registration_changeset(%User{}, %{"email" => email, "password" => "password123"}))
  end

  defp insert_simplefin_job(user, attrs \\ %{}) do
    {:ok, encrypted} = Finapp.Vault.encrypt(@access_url)

    defaults = %{
      user_id: user.id,
      account_token_ref: "ref-#{System.unique_integer([:positive])}",
      connection_type: "simplefin",
      encrypted_access_url_ref: encrypted
    }

    Repo.insert!(SyncJob.changeset(%SyncJob{}, Map.merge(defaults, attrs)))
  end

  defp insert_gocardless_job(user) do
    # GoCardless stores encrypted account IDs in the same field
    {:ok, encrypted} = Finapp.Vault.encrypt("gc-account-id-abc")

    Repo.insert!(%SyncJob{
      user_id: user.id,
      account_token_ref: "ref-gc-#{System.unique_integer([:positive])}",
      connection_type: "gocardless",
      encrypted_access_url_ref: encrypted
    })
  end

  # Set a 32-byte AES-256 session key in Redis for the given user.
  # Stored as base64 to match what DeviceChannel.join writes.
  defp set_session_key(user_id) do
    key = :crypto.strong_rand_bytes(32)
    {:ok, "OK"} = Redix.command(:redix, ["SET", "session_key:#{user_id}", Base.encode64(key)])
    key
  end

  defp simplefin_stub(fun), do: Req.Test.stub(Finapp.Sync.SimpleFin, fun)
  defp gocardless_stub(fun), do: Req.Test.stub(Finapp.Sync.GoCardless, fun)

  defp json_resp(conn, status \\ 200, body) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(status, Jason.encode!(body))
  end

  defp perform(job_id) do
    BankSyncWorker.perform(%Oban.Job{args: %{"sync_job_id" => job_id}})
  end

  describe "SimpleFIN adapter — success" do
    test "broadcasts sync:complete to PubSub with encrypted payload", %{conn: _conn} do
      user = create_user()
      job = insert_simplefin_job(user)
      set_session_key(user.id)
      Phoenix.PubSub.subscribe(Finapp.PubSub, "user:#{user.id}")

      simplefin_stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{
              "id" => "acct_1",
              "currency" => "USD",
              "transactions" => [
                %{"id" => "tx_1", "amount" => "-42.50", "description" => "Coffee",
                  "posted" => "2026-04-01", "pending" => false}
              ]
            }
          ]
        })
      end)

      assert :ok = perform(job.id)

      assert_receive {:sync_complete, payload}, 1000
      assert payload.account_token_ref == job.account_token_ref
      assert payload.transaction_count == 1
      # Wire format: base64( iv[12] ++ ciphertext ++ tag[16] ) — matches decryptBatch in @fresh/core
      assert is_binary(payload.encrypted_batch)
      assert {:ok, blob} = Base.decode64(payload.encrypted_batch)
      assert byte_size(blob) > 12
    end

    test "updates last_cursor and last_synced_at on success", %{conn: _conn} do
      user = create_user("cursor@example.com")
      job = insert_simplefin_job(user)
      set_session_key(user.id)

      simplefin_stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{
              "id" => "acct_1",
              "currency" => "USD",
              "transactions" => [
                %{"id" => "tx_1", "amount" => "-10.00", "posted" => "2026-04-15", "pending" => false}
              ]
            }
          ]
        })
      end)

      assert :ok = perform(job.id)

      updated = Repo.get(SyncJob, job.id)
      assert updated.last_cursor == "2026-04-15"
      assert updated.last_synced_at != nil
    end
  end

  describe "SimpleFIN adapter — device offline (no session key)" do
    test "snoozes for 300 seconds when device has no session key in Redis", %{conn: _conn} do
      user = create_user("offline@example.com")
      job = insert_simplefin_job(user)
      # Explicitly ensure no session key exists for this user
      Redix.command(:redix, ["DEL", "session_key:#{user.id}"])

      simplefin_stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{
              "id" => "acct_1",
              "currency" => "USD",
              "transactions" => [
                %{"id" => "tx_1", "amount" => "-10.00", "posted" => "2026-04-20", "pending" => false}
              ]
            }
          ]
        })
      end)

      assert {:snooze, 300} = perform(job.id)

      # Cursor must NOT be updated — we haven't delivered the data yet
      updated = Repo.get(SyncJob, job.id)
      assert updated.last_cursor == nil
      assert updated.last_synced_at == nil
    end
  end

  describe "SimpleFIN adapter — rate limited" do
    test "snoozes for 60 seconds and does not update the cursor", %{conn: _conn} do
      user = create_user("ratelimited@example.com")
      job = insert_simplefin_job(user)
      set_session_key(user.id)

      simplefin_stub(fn conn ->
        conn
        |> Plug.Conn.put_resp_content_type("application/json")
        |> Plug.Conn.send_resp(429, "{}")
      end)

      assert {:snooze, 60} = perform(job.id)

      updated = Repo.get(SyncJob, job.id)
      assert updated.last_cursor == nil
      assert updated.last_synced_at == nil
    end
  end

  describe "SimpleFIN adapter — connection expired" do
    test "marks job as expired and broadcasts sync:error", %{conn: _conn} do
      user = create_user("expired@example.com")
      job = insert_simplefin_job(user)
      set_session_key(user.id)
      Phoenix.PubSub.subscribe(Finapp.PubSub, "user:#{user.id}")

      simplefin_stub(fn conn ->
        conn
        |> Plug.Conn.put_resp_content_type("application/json")
        |> Plug.Conn.send_resp(401, "{}")
      end)

      assert :ok = perform(job.id)

      updated = Repo.get(SyncJob, job.id)
      assert updated.status == "expired"

      assert_receive {:sync_error, %{reason: "connection_expired", account_token_ref: ref}}, 1000
      assert ref == job.account_token_ref
    end
  end

  describe "GoCardless adapter — success" do
    test "broadcasts sync:complete and updates cursor", %{conn: _conn} do
      user = create_user("gc-user@example.com")
      job = insert_gocardless_job(user)
      set_session_key(user.id)
      Phoenix.PubSub.subscribe(Finapp.PubSub, "user:#{user.id}")

      gocardless_stub(fn conn ->
        case conn.request_path do
          "/api/v2/token/new/" ->
            json_resp(conn, %{"access" => "gc-test-token"})

          "/api/v2/accounts/gc-account-id-abc/transactions/" ->
            json_resp(conn, %{
              "transactions" => %{
                "booked" => [
                  %{
                    "transactionId" => "gc-tx-1",
                    "bookingDate" => "2026-04-10",
                    "transactionAmount" => %{"amount" => "-55.00", "currency" => "EUR"},
                    "remittanceInformationUnstructured" => "Rent"
                  }
                ],
                "pending" => []
              }
            })
        end
      end)

      assert :ok = perform(job.id)

      assert_receive {:sync_complete, payload}, 1000
      assert payload.transaction_count == 1

      updated = Repo.get(SyncJob, job.id)
      assert updated.last_cursor == "2026-04-10"
    end
  end
end
