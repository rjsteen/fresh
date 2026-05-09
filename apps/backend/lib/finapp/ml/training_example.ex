defmodule Finapp.ML.TrainingExample do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  # Feature vector length must match packages/core/src/ml/inference.ts INPUT_DIM
  @input_dim 100

  schema "ml_training_examples" do
    field :model_type, :string
    field :features, {:array, :float}
    field :label, :string
    field :exported_at, :utc_datetime

    timestamps(type: :utc_datetime)
  end

  def changeset(example, attrs) do
    example
    |> cast(attrs, [:model_type, :features, :label])
    |> validate_required([:model_type, :features, :label])
    |> validate_inclusion(:model_type, ["categorizer", "anomaly"])
    |> validate_length(:features, is: @input_dim)
  end
end
