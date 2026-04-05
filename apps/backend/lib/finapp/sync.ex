defmodule Finapp.Sync do
  import Ecto.Query
  alias Finapp.Repo
  alias Finapp.Sync.SyncJob

  def ack_sync(account_token_ref, user_id) do
    Repo.one(
      from j in SyncJob,
        where: j.account_token_ref == ^account_token_ref and j.user_id == ^user_id
    )
    |> case do
      nil -> :ok
      job ->
        job
        |> Ecto.Changeset.change(last_synced_at: DateTime.utc_now() |> DateTime.truncate(:second))
        |> Repo.update()
        :ok
    end
  end

  def list_jobs_for_user(user_id) do
    Repo.all(from j in SyncJob, where: j.user_id == ^user_id)
  end

  def get_job(id, user_id) do
    Repo.one(from j in SyncJob, where: j.id == ^id and j.user_id == ^user_id)
  end

  def trigger_sync(job) do
    %{sync_job_id: job.id}
    |> Finapp.Sync.BankSyncWorker.new()
    |> Oban.insert()
  end

  def update_schedule(job, schedule) do
    job
    |> SyncJob.changeset(%{sync_schedule: schedule})
    |> Repo.update()
  end
end
