defmodule Finapp.Accounts.Device do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @doc """
  Represents a registered device (mobile or web).
  The backend tracks devices to route push signals — it never stores
  financial data or knows what the device has locally.
  """
  schema "devices" do
    field :name, :string                          # "iPhone 15", "Chrome on Mac", etc.
    field :platform, :string                      # "ios" | "android" | "web"
    field :push_token, :string                    # FCM/APNS token for push delivery
    field :last_seen_at, :utc_datetime

    # Opaque token refs registered by this device for alert delivery.
    # Stored as an array of strings — backend has no knowledge of what each ref means.
    field :alert_token_refs, {:array, :string}, default: []

    belongs_to :user, Finapp.Accounts.User

    timestamps(type: :utc_datetime)
  end

  def changeset(device, attrs) do
    device
    |> cast(attrs, [:name, :platform, :push_token, :last_seen_at, :alert_token_refs, :user_id])
    |> validate_required([:name, :platform, :user_id])
    |> validate_inclusion(:platform, ["ios", "android", "web"])
    |> foreign_key_constraint(:user_id)
  end

  def touch_changeset(device) do
    change(device, last_seen_at: DateTime.utc_now() |> DateTime.truncate(:second))
  end
end
