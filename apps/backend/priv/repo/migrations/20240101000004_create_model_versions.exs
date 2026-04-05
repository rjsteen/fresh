defmodule Finapp.Repo.Migrations.CreateModelVersions do
  use Ecto.Migration

  def change do
    # Tracks current model versions — used to tell devices what to download
    # and to trigger model:updated signals when a new model is deployed.
    create table(:model_versions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :model_type, :string, null: false    # "categorizer" | "anomaly"
      add :version, :string, null: false
      add :cdn_path, :string, null: false
      add :checksum_sha256, :string, null: false
      add :is_current, :boolean, null: false, default: false
      add :deployed_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:model_versions, [:model_type, :version])
    create index(:model_versions, [:model_type, :is_current])
  end
end
