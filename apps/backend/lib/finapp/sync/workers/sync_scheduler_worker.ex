defmodule Finapp.Sync.SyncSchedulerWorker do
  @moduledoc """
  Periodic job that enqueues BankSyncWorker for active sync jobs that need a refresh:
  - Jobs that have never synced (initial sync)
  - Jobs whose last sync is more than 4 hours old (recurring sync)

  Runs every 5 minutes via Oban.Plugins.Cron. The 4-hour staleness threshold matches
  the default sync_schedule ("0 */4 * * *") stored on each SyncJob.
  """

  use Oban.Worker, queue: :bank_sync, max_attempts: 1

  import Ecto.Query

  alias Finapp.Repo
  alias Finapp.Sync.{BankSyncWorker, SyncJob}

  # Jobs last synced more than this many seconds ago are considered stale.
  @stale_after_seconds 4 * 60 * 60

  @impl Oban.Worker
  def perform(_job) do
    (never_synced_jobs() ++ stale_jobs())
    |> Enum.uniq_by(& &1.id)
    |> Enum.each(fn job ->
      %{sync_job_id: job.id}
      |> BankSyncWorker.new()
      |> Oban.insert()
    end)

    :ok
  end

  defp never_synced_jobs do
    Repo.all(
      from j in SyncJob,
        where: j.status == "active" and is_nil(j.last_synced_at)
    )
  end

  defp stale_jobs do
    stale_cutoff = DateTime.add(DateTime.utc_now(), -@stale_after_seconds)

    Repo.all(
      from j in SyncJob,
        where: j.status == "active" and not is_nil(j.last_synced_at) and j.last_synced_at < ^stale_cutoff
    )
  end
end
