defmodule Finapp.Accounts.StaleDeviceWorker do
  @moduledoc "Removes devices that haven't been seen in 90 days."

  use Oban.Worker, queue: :notifications, max_attempts: 3

  import Ecto.Query
  alias Finapp.Repo

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    cutoff = DateTime.utc_now() |> DateTime.add(-90, :day) |> DateTime.truncate(:second)

    {count, _} =
      Repo.delete_all(
        from d in Finapp.Accounts.Device,
          where: d.last_seen_at < ^cutoff or is_nil(d.last_seen_at)
      )

    if count > 0, do: require(Logger) && Logger.info("[StaleDeviceWorker] Removed #{count} stale devices")

    :ok
  end
end
