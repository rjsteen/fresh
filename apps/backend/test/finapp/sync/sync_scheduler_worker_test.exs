defmodule Finapp.Sync.SyncSchedulerWorkerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.User
  alias Finapp.Sync.{BankSyncWorker, SyncJob, SyncSchedulerWorker}

  defp create_user(email \\ "scheduler@example.com") do
    Repo.insert!(User.registration_changeset(%User{}, %{"email" => email, "password" => "password123"}))
  end

  defp insert_job(user, attrs) do
    {:ok, encrypted} = Finapp.Vault.encrypt("https://user:secret@bridge.simplefin.org/simplefin")

    changeset_attrs = %{
      user_id: user.id,
      account_token_ref: "ref-#{System.unique_integer([:positive])}",
      connection_type: "simplefin",
      encrypted_access_url_ref: encrypted,
      status: Map.get(attrs, :status, "active")
    }

    # last_synced_at is not in the changeset cast list (worker-only field),
    # so apply it via change/2 after building the validated changeset.
    extra = Map.take(attrs, [:last_synced_at])

    %SyncJob{}
    |> SyncJob.changeset(changeset_attrs)
    |> Ecto.Changeset.change(extra)
    |> Repo.insert!()
  end

  test "enqueues BankSyncWorker for every active job with no last_synced_at" do
    user = create_user()
    job1 = insert_job(user, %{})
    job2 = insert_job(user, %{})

    assert :ok = perform_job(SyncSchedulerWorker, %{})

    assert_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => job1.id})
    assert_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => job2.id})
  end

  test "skips recently synced jobs" do
    user = create_user("scheduler2@example.com")
    synced = insert_job(user, %{last_synced_at: DateTime.utc_now() |> DateTime.truncate(:second)})

    assert :ok = perform_job(SyncSchedulerWorker, %{})

    refute_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => synced.id})
  end

  test "re-enqueues stale jobs whose last sync is more than 4 hours ago" do
    user = create_user("scheduler-stale@example.com")
    stale_time = DateTime.add(DateTime.utc_now(), -(4 * 3600 + 60)) |> DateTime.truncate(:second)
    stale = insert_job(user, %{last_synced_at: stale_time})

    assert :ok = perform_job(SyncSchedulerWorker, %{})

    assert_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => stale.id})
  end

  test "skips expired and paused jobs" do
    user = create_user("scheduler3@example.com")
    expired = insert_job(user, %{status: "expired"})
    paused  = insert_job(user, %{status: "paused"})

    assert :ok = perform_job(SyncSchedulerWorker, %{})

    refute_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => expired.id})
    refute_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => paused.id})
  end
end
