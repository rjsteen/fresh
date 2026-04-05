defmodule Finapp.Repo.Migrations.CreateSyncJobs do
  use Ecto.Migration

  def change do
    create table(:sync_jobs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      # Opaque token used by the device to identify which local account this sync is for.
      # The backend has no knowledge of what account this is.
      add :account_token_ref, :string, null: false

      # "simplefin" | "gocardless"
      add :connection_type, :string, null: false

      # Encrypted access URL (SimpleFIN) or account ID (GoCardless).
      # Uses Cloak AES-GCM encryption — the plaintext value is never stored.
      add :encrypted_access_url_ref, :binary, null: false

      # Continuation cursor from the last successful fetch
      add :last_cursor, :string
      add :last_synced_at, :utc_datetime
      add :status, :string, null: false, default: "active"   # "active" | "expired" | "paused"

      # Cron expression for Oban scheduling (e.g. "*/30 * * * *" = every 30 minutes)
      add :sync_schedule, :string, null: false, default: "0 */4 * * *"

      timestamps(type: :utc_datetime)
    end

    create index(:sync_jobs, [:user_id])
    create unique_index(:sync_jobs, [:account_token_ref])

    # Oban tables are created by the Oban migration
    Oban.Migration.up(version: 12)
  end
end
