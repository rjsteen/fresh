defmodule Finapp.Repo.Migrations.CreateDevices do
  use Ecto.Migration

  def change do
    create table(:devices, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :name, :string, null: false
      add :platform, :string, null: false
      add :push_token, :string
      add :last_seen_at, :utc_datetime
      add :alert_token_refs, {:array, :string}, null: false, default: []

      timestamps(type: :utc_datetime)
    end

    create index(:devices, [:user_id])
    create index(:devices, [:push_token])
  end
end
