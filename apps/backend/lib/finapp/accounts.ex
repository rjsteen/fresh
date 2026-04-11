defmodule Finapp.Accounts do
  @moduledoc false

  import Ecto.Query
  alias Finapp.Accounts.{Device, User}
  alias Finapp.Repo

  def delete_user(%User{} = user, password) do
    if Bcrypt.verify_pass(password, user.password_hash) do
      Phoenix.PubSub.broadcast(Finapp.PubSub, "user:#{user.id}", {:account_deleted, %{}})
      Repo.delete(user)
    else
      {:error, :invalid_password}
    end
  end

  def update_user(%User{} = user, attrs) do
    with :ok <- verify_password_change(user, attrs) do
      user
      |> User.update_changeset(attrs)
      |> Repo.update()
    end
  end

  defp verify_password_change(user, attrs) do
    case attrs["new_password"] || attrs[:new_password] do
      nil ->
        :ok

      _new_password ->
        current = attrs["current_password"] || attrs[:current_password]

        if current && Bcrypt.verify_pass(current, user.password_hash) do
          :ok
        else
          {:error, :invalid_password}
        end
    end
  end

  def get_user(id), do: Repo.get(User, id)

  def get_device_by_user(user_id) do
    Repo.one(from d in Device, where: d.user_id == ^user_id, limit: 1)
  end

  def add_alert_token(user_id, token_ref) do
    device = get_device_by_user(user_id)
    if device && token_ref not in device.alert_token_refs do
      device
      |> Device.changeset(%{alert_token_refs: [token_ref | device.alert_token_refs]})
      |> Repo.update()
    else
      {:ok, device}
    end
  end

  def remove_alert_token(user_id, token_ref) do
    device = get_device_by_user(user_id)
    if device do
      device
      |> Device.changeset(%{alert_token_refs: List.delete(device.alert_token_refs, token_ref)})
      |> Repo.update()
    else
      {:ok, nil}
    end
  end
end
