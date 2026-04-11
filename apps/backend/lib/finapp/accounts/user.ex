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
    new_password = attrs["new_password"] || attrs[:new_password]

    user
    |> cast(attrs, [:timezone, :region])
    |> validate_inclusion(:region, ["us", "eu"])
    |> validate_timezone()
    |> validate_new_password(new_password)
    |> put_password_hash(new_password)
  end

  defp validate_timezone(changeset) do
    case get_change(changeset, :timezone) do
      nil -> changeset
      tz ->
        case DateTime.now(tz) do
          {:ok, _} -> changeset
          _ -> add_error(changeset, :timezone, "is not a valid timezone")
        end
    end
  end

  defp validate_new_password(changeset, nil), do: changeset
  defp validate_new_password(changeset, password) do
    cond do
      String.length(password) < 12 ->
        add_error(changeset, :new_password, "must be at least 12 characters")
      String.length(password) > 72 ->
        add_error(changeset, :new_password, "must be at most 72 characters")
      not String.match?(password, ~r/[^a-zA-Z]/) ->
        add_error(changeset, :new_password, "must contain at least one number or symbol")
      true ->
        changeset
    end
  end

  defp put_password_hash(changeset, nil), do: changeset
  defp put_password_hash(changeset, password) do
    if changeset.valid? do
      put_change(changeset, :password_hash, Bcrypt.hash_pwd_salt(password))
    else
      changeset
    end
  end
end
