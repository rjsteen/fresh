defmodule Finapp.Sync.SyncSchedulerWorker do
  @moduledoc """
  Periodic job that finds sync jobs that have never completed a sync and enqueues
  them for immediate processing. Runs every 5 minutes as a safety net for jobs
  whose initial trigger (fired on claim) failed or exhausted retries.
  """

  use Oban.Worker, queue: :bank_sync, max_attempts: 1

  import Ecto.Query

  alias Finapp.Repo
  alias Finapp.Sync.{BankSyncWorker, SyncJob}

  @impl Oban.Worker
  def perform(_job) do
    never_synced_jobs()
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
end
