defmodule Finapp.Repo.Migrations.CreateMlTrainingExamples do
  use Ecto.Migration

  def change do
    create table(:ml_training_examples, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :model_type, :string, null: false
      add :features, {:array, :float}, null: false
      add :label, :string, null: false
      add :exported_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:ml_training_examples, [:model_type, :exported_at])
  end
end
