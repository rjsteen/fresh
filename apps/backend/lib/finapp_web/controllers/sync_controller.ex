defmodule FinappWeb.SyncController do
  use Phoenix.Controller, formats: [:json]

  alias Finapp.Sync
  alias Guardian.Plug

  def list_jobs(conn, _params) do
    user = Plug.current_resource(conn)
    jobs = Sync.list_jobs_for_user(user.id)

    json(conn, %{
      jobs:
        Enum.map(jobs, fn j ->
          %{
            id: j.id,
            account_token_ref: j.account_token_ref,
            connection_type: j.connection_type,
            status: j.status,
            sync_schedule: j.sync_schedule,
            last_synced_at: j.last_synced_at
          }
        end)
    })
  end

  def trigger_now(conn, %{"id" => id}) do
    user = Plug.current_resource(conn)

    case Sync.get_job(id, user.id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})

      job ->
        case Sync.trigger_sync(job) do
          {:ok, _} -> json(conn, %{ok: true})
          {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
        end
    end
  end

  def update_schedule(conn, %{"id" => id, "schedule" => schedule}) do
    user = Plug.current_resource(conn)

    case Sync.get_job(id, user.id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})

      job ->
        case Sync.update_schedule(job, schedule) do
          {:ok, updated} -> json(conn, %{ok: true, sync_schedule: updated.sync_schedule})
          {:error, changeset} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: changeset})
        end
    end
  end
end
