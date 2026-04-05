defmodule Finapp.Sync.SyncJob do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "sync_jobs" do
    field :account_token_ref, :string
    field :connection_type, :string
    field :encrypted_access_url_ref, :binary
    field :last_cursor, :string
    field :last_synced_at, :utc_datetime
    field :status, :string, default: "active"
    field :sync_schedule, :string, default: "0 */4 * * *"

    belongs_to :user, Finapp.Accounts.User

    timestamps(type: :utc_datetime)
  end

  def changeset(job, attrs) do
    job
    |> cast(attrs, [:account_token_ref, :connection_type, :encrypted_access_url_ref,
                    :last_cursor, :status, :sync_schedule, :user_id])
    |> validate_required([:account_token_ref, :connection_type, :encrypted_access_url_ref, :user_id])
    |> validate_inclusion(:connection_type, ["simplefin", "gocardless"])
    |> validate_inclusion(:status, ["active", "expired", "paused"])
    |> unique_constraint(:account_token_ref)
    |> foreign_key_constraint(:user_id)
  end
end
