defmodule FinappWeb.SyncControllerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.User
  alias Finapp.Sync.{BankSyncWorker, SyncJob}

  defp create_user(attrs \\ %{}) do
    attrs = Map.merge(%{"email" => "test@example.com", "password" => "password123"}, attrs)
    Repo.insert!(User.registration_changeset(%User{}, attrs))
  end

  defp authed(conn, user) do
    {:ok, token, _claims} = Finapp.Guardian.build_token(user)
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  defp insert_sync_job(user, attrs \\ %{}) do
    {:ok, encrypted} = Finapp.Vault.encrypt("https://user:secret@bridge.simplefin.org/simplefin")

    defaults = %{
      user_id: user.id,
      account_token_ref: "ref-#{System.unique_integer([:positive])}",
      connection_type: "simplefin",
      encrypted_access_url_ref: encrypted
    }

    Repo.insert!(SyncJob.changeset(%SyncJob{}, Map.merge(defaults, attrs)))
  end

  describe "GET /api/v1/sync/jobs" do
    test "returns all sync jobs for the current user", %{conn: conn} do
      user = create_user()
      job1 = insert_sync_job(user, %{account_token_ref: "ref-aaa"})
      job2 = insert_sync_job(user, %{account_token_ref: "ref-bbb"})

      body =
        conn
        |> authed(user)
        |> get("/api/v1/sync/jobs")
        |> json_response(200)

      ids = Enum.map(body["jobs"], & &1["id"])
      assert job1.id in ids
      assert job2.id in ids
    end

    test "does not return jobs belonging to another user", %{conn: conn} do
      user1 = create_user(%{"email" => "u1@example.com"})
      user2 = create_user(%{"email" => "u2@example.com"})
      insert_sync_job(user2, %{account_token_ref: "ref-other"})

      body =
        conn
        |> authed(user1)
        |> get("/api/v1/sync/jobs")
        |> json_response(200)

      assert body["jobs"] == []
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      assert get(conn, "/api/v1/sync/jobs").status == 401
    end
  end

  describe "POST /api/v1/sync/jobs/:id/trigger" do
    test "enqueues a BankSyncWorker job and returns ok", %{conn: conn} do
      user = create_user()
      job = insert_sync_job(user)

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/sync/jobs/#{job.id}/trigger")

      assert json_response(resp, 200) == %{"ok" => true}

      assert_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => job.id})
    end

    test "returns 404 for another user's job", %{conn: conn} do
      user1 = create_user(%{"email" => "u1@example.com"})
      user2 = create_user(%{"email" => "u2@example.com"})
      job = insert_sync_job(user2)

      resp =
        conn
        |> authed(user1)
        |> post("/api/v1/sync/jobs/#{job.id}/trigger")

      assert json_response(resp, 404) == %{"error" => "not_found"}
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      assert post(conn, "/api/v1/sync/jobs/some-id/trigger").status == 401
    end
  end

  describe "PUT /api/v1/sync/jobs/:id/schedule" do
    test "updates the sync schedule and returns ok", %{conn: conn} do
      user = create_user()
      job = insert_sync_job(user)

      resp =
        conn
        |> authed(user)
        |> put("/api/v1/sync/jobs/#{job.id}/schedule", %{"schedule" => "0 */6 * * *"})

      body = json_response(resp, 200)
      assert body["ok"] == true
      assert body["sync_schedule"] == "0 */6 * * *"

      updated = Repo.get(SyncJob, job.id)
      assert updated.sync_schedule == "0 */6 * * *"
    end

    test "returns 404 for another user's job", %{conn: conn} do
      user1 = create_user(%{"email" => "u1@example.com"})
      user2 = create_user(%{"email" => "u2@example.com"})
      job = insert_sync_job(user2)

      resp =
        conn
        |> authed(user1)
        |> put("/api/v1/sync/jobs/#{job.id}/schedule", %{"schedule" => "0 * * * *"})

      assert json_response(resp, 404) == %{"error" => "not_found"}
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      assert put(conn, "/api/v1/sync/jobs/some-id/schedule", %{"schedule" => "0 * * * *"}).status == 401
    end
  end
end
