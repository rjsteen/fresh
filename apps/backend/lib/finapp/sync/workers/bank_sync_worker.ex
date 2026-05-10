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
      {:error, :no_session_key} ->
        # Device is not connected — no session key in Redis yet.
        # Snooze and retry; the key will be available once the device reconnects.
        Logger.info("[BankSync] device offline, snoozing 300s",
          sync_job_id: sync_job_id,
          user_id: sync_job.user_id
        )
        {:snooze, 300}

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
    with {:ok, enc_txns} <- encrypt_for_device(sync_job.user_id, result.transactions),
         {:ok, enc_accounts} <- encrypt_for_device(sync_job.user_id, result.accounts) do
      payload = %{
        account_token_ref: sync_job.account_token_ref,
        transaction_count: length(result.transactions),
        cursor: result.next_cursor,
        # Wire format matches the frontend's decryptBatch expectation:
        # base64( iv[12] ++ ciphertext ++ tag[16] )
        encrypted_batch: enc_txns,
        encrypted_accounts: enc_accounts
      }

      Phoenix.PubSub.broadcast(
        Finapp.PubSub,
        "user:#{sync_job.user_id}",
        {:sync_complete, payload}
      )

      :ok
    end
  end

  defp encrypt_for_device(user_id, data) do
    # In production, use a per-session ECDH-derived key from the device's public key.
    # For the prototype, we use a symmetric key stored in the user's session.
    # The device decrypts this client-side; the backend discards the plaintext.
    #
    # Wire format: base64( iv[12 bytes] ++ ciphertext ++ tag[16 bytes] )
    # Matches the Web Crypto AES-GCM layout expected by decryptBatch in @fresh/core/sync.
    with {:ok, key} <- get_device_session_key(user_id) do
      plaintext = Jason.encode!(data)
      iv = :crypto.strong_rand_bytes(12)
      {ciphertext, tag} = :crypto.crypto_one_time_aead(:aes_256_gcm, key, iv, plaintext, "", true)
      {:ok, Base.encode64(iv <> ciphertext <> tag)}
    end
  end

  defp get_device_session_key(user_id) do
    # Retrieve the ephemeral session key from Redis (set at WebSocket connect time).
    # Stored as base64 to avoid raw-binary issues in Redis; decode before use.
    # Key expires with the session — no long-term storage of device keys.
    case Redix.command(:redix, ["GET", "session_key:#{user_id}"]) do
      {:ok, encoded} when is_binary(encoded) ->
        case Base.decode64(encoded) do
          {:ok, key} -> {:ok, key}
          :error -> {:error, :no_session_key}
        end
      _ -> {:error, :no_session_key}
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
