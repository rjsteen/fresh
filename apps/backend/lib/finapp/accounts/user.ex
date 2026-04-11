defmodule Finapp.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "users" do
    field :email, :string
    field :password_hash, :string
    field :region, :string, default: "us"        # "us" | "eu" determines SimpleFIN vs GoCardless

    # No financial preferences stored here — those live in the encrypted device DB
    field :push_token, :string                   # Device push notification token
    field :timezone, :string, default: "UTC"

    has_many :devices, Finapp.Accounts.Device
    has_many :sync_jobs, Finapp.Sync.SyncJob

    timestamps(type: :utc_datetime)
  end

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :region, :timezone])
    |> validate_required([:email])
    |> validate_format(:email, ~r/^[^\s]+@[^\s]+$/, message: "must be a valid email address")
    |> validate_inclusion(:region, ["us", "eu"])
    |> unique_constraint(:email)
    |> put_password_hash(attrs["password"] || attrs[:password])
  end

  def update_changeset(user, attrs) do
    user
    |> cast(attrs, [:timezone, :region])
    |> validate_inclusion(:region, ["us", "eu"])
    |> put_password_hash(attrs["new_password"] || attrs[:new_password])
  end

  defp put_password_hash(changeset, nil), do: changeset
  defp put_password_hash(changeset, password) do
    put_change(changeset, :password_hash, Bcrypt.hash_pwd_salt(password))
  end
end
