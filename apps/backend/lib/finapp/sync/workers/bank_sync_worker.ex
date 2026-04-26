defmodule Finapp.Sync.BankSyncWorker do
  @moduledoc """
  Oban worker that polls a bank via SimpleFIN (US) or GoCardless (EU),
  encrypts the result in transit, then pushes a `sync:complete` signal
  to the device via Phoenix Channel.

  PRIVACY CONTRACT:
  - The raw transaction data from the bank IS seen by this worker, briefly.
  - It is encrypted with a per-user key and delivered directly to the device.
  - It is NEVER written to Postgres.
  - Postgres stores only: the account_token_ref, the cursor, and job metadata.
  """

  use Oban.Worker,
    queue: :bank_sync,
    max_attempts: 5,
    priority: 1,
    unique: [keys: [:sync_job_id], period: 300]

  require Logger

  alias Finapp.Notifications.PushWorker
  alias Finapp.Repo
  alias Finapp.Sync.{GoCardless, SimpleFin, SyncJob}

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"sync_job_id" => sync_job_id}, attempt: attempt}) do
    sync_job = Repo.get!(SyncJob, sync_job_id) |> Repo.preload(:user)

    Logger.info("[BankSync] starting sync",
      sync_job_id: sync_job_id,
      connection_type: sync_job.connection_type,
      user_id: sync_job.user_id,
      attempt: attempt
    )

    with {:ok, adapter} <- get_adapter(sync_job),
         {:ok, result} <- adapter.fetch_transactions(sync_job),
         :ok <- broadcast_to_device(sync_job, result) do
      update_cursor(sync_job, result.next_cursor)
      enqueue_sync_push(sync_job)

      Logger.info("[BankSync] sync complete",
        sync_job_id: sync_job_id,
        user_id: sync_job.user_id,
        transaction_count: length(result.transactions)
      )

      :ok
    else
      {:error, :rate_limited} ->
        Logger.warning("[BankSync] rate limited, snoozing 60s",
          sync_job_id: sync_job_id,
          user_id: sync_job.user_id
        )
        {:snooze, 60}

      {:error, :connection_expired} ->
        Logger.warning("[BankSync] connection expired",
          sync_job_id: sync_job_id,
          user_id: sync_job.user_id
        )
        mark_connection_expired(sync_job)
        :ok

      {:error, reason} ->
        Logger.error("[BankSync] sync failed",
          sync_job_id: sync_job_id,
          user_id: sync_job.user_id,
          reason: inspect(reason)
        )
        {:error, reason}
    end
  end

  defp get_adapter(%{connection_type: "simplefin"}), do: {:ok, SimpleFin}
  defp get_adapter(%{connection_type: "gocardless"}), do: {:ok, GoCardless}
  defp get_adapter(%{connection_type: type}), do: {:error, "Unknown connection type: #{type}"}

  defp broadcast_to_device(sync_job, result) do
    payload = %{
      account_token_ref: sync_job.account_token_ref,
      transaction_count: length(result.transactions),
      cursor: result.next_cursor,
      # Transactions are encrypted with the device's session key before broadcasting.
      # The Phoenix process handles this encryption; Postgres never touches this data.
      encrypted_transactions: encrypt_for_device(sync_job.user_id, result.transactions)
    }

    Phoenix.PubSub.broadcast(
      Finapp.PubSub,
      "user:#{sync_job.user_id}",
      {:sync_complete, payload}
    )

    :ok
  end

  defp encrypt_for_device(user_id, transactions) do
    # In production, use a per-session ECDH-derived key from the device's public key.
    # For the prototype, we use a symmetric key stored in the user's session.
    # The device decrypts this client-side; the backend discards the plaintext.
    key = get_device_session_key(user_id)
    plaintext = Jason.encode!(transactions)
    iv = :crypto.strong_rand_bytes(12)
    {ciphertext, tag} = :crypto.crypto_one_time_aead(:aes_256_gcm, key, iv, plaintext, "", true)
    %{
      ciphertext: Base.encode64(ciphertext),
      tag: Base.encode64(tag),
      iv: Base.encode64(iv)
    }
  end

  defp get_device_session_key(user_id) do
    # Retrieve the ephemeral session key from Redis (set at WebSocket connect time).
    # Key expires with the session — no long-term storage of device keys.
    case Redix.command(:redix, ["GET", "session_key:#{user_id}"]) do
      {:ok, key} when is_binary(key) -> key
      _ -> raise "No session key for user #{user_id}"
    end
  end

  defp enqueue_sync_push(sync_job) do
    case %{
           "user_id" => sync_job.user_id,
           "title" => "Sync complete",
           "body" => "New transactions are ready.",
           "data" => %{"event" => "sync:complete"}
         }
         |> PushWorker.new()
         |> Oban.insert() do
      {:ok, _job} ->
        :ok

      {:error, reason} ->
        Logger.warning("Failed to enqueue sync push for user #{sync_job.user_id}: #{inspect(reason)}")
        :ok
    end
  end

  defp update_cursor(sync_job, next_cursor) do
    sync_job
    |> Ecto.Changeset.change(last_cursor: next_cursor, last_synced_at: DateTime.utc_now() |> DateTime.truncate(:second))
    |> Repo.update!()
  end

  defp mark_connection_expired(sync_job) do
    sync_job
    |> Ecto.Changeset.change(status: "expired")
    |> Repo.update!()

    Phoenix.PubSub.broadcast(
      Finapp.PubSub,
      "user:#{sync_job.user_id}",
      {:sync_error, %{account_token_ref: sync_job.account_token_ref, reason: "connection_expired"}}
    )
  end
end
