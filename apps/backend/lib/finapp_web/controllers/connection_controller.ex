defmodule FinappWeb.ConnectionController do
  use Phoenix.Controller, formats: [:json]

  alias Finapp.{Repo, Sync, Vault}
  alias Finapp.Sync.{GoCardless, SimpleFin, SyncJob}
  alias Guardian.Plug

  # POST /api/v1/connections/simplefin/claim
  # Body: { "setup_token": "<base64 claim URL>", "account_token_ref": "<opaque device ref>" }
  def simplefin_claim(conn, %{"setup_token" => setup_token, "account_token_ref" => token_ref}) do
    user = Plug.current_resource(conn)

    with {:ok, access_url} <- SimpleFin.claim_access_url(setup_token),
         {:ok, encrypted} <- Vault.encrypt(access_url),
         {:ok, job} <-
           Repo.insert(
             SyncJob.changeset(%SyncJob{}, %{
               user_id: user.id,
               account_token_ref: token_ref,
               connection_type: "simplefin",
               encrypted_access_url_ref: encrypted
             })
           ) do
      Sync.trigger_sync(job)
      json(conn, %{ok: true, sync_job_id: job.id})
    else
      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: inspect(reason)})
    end
  end

  # POST /api/v1/connections/gocardless/requisition
  # Body: { "institution_id": "...", "account_token_ref": "...", "redirect_url": "..." }
  def gocardless_requisition(conn, params) do
    user = Plug.current_resource(conn)
    reference = "#{user.id}-#{System.system_time(:millisecond)}"

    case GoCardless.create_requisition(
           params["institution_id"],
           params["redirect_url"],
           reference
         ) do
      {:ok, result} ->
        json(conn, %{link: result.link, requisition_id: result.id})

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: inspect(reason)})
    end
  end

  # GET /api/v1/connections/gocardless/requisition/:id/status
  # Called after the user completes bank auth to finalize the connection
  def gocardless_status(conn, %{"id" => _requisition_id, "account_token_ref" => token_ref}) do
    user = Plug.current_resource(conn)

    # In a real impl: fetch the requisition, get the account IDs, store encrypted
    # For now return a placeholder indicating the requisition needs to be polled
    json(conn, %{status: "pending", account_token_ref: token_ref, user_id: user.id})
  end

  def gocardless_status(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "account_token_ref required"})
  end

  # DELETE /api/v1/connections/:id
  def disconnect(conn, %{"id" => job_id}) do
    user = Plug.current_resource(conn)

    case Repo.get_by(SyncJob, id: job_id, user_id: user.id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})

      job ->
        Repo.delete(job)
        json(conn, %{ok: true})
    end
  end
end
