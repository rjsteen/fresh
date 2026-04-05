defmodule FinappWeb.DeviceController do
  use Phoenix.Controller, formats: [:json]

  alias Finapp.Repo
  alias Finapp.Accounts.Device
  alias Guardian.Plug

  def register(conn, params) do
    user = Plug.current_resource(conn)

    changeset =
      Device.changeset(%Device{}, %{
        name: params["name"] || "Unknown Device",
        platform: params["platform"] || "web",
        push_token: params["push_token"],
        user_id: user.id
      })

    case Repo.insert(changeset) do
      {:ok, device} ->
        conn
        |> put_status(:created)
        |> json(%{device_id: device.id})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def deregister(conn, %{"id" => id}) do
    user = Plug.current_resource(conn)

    case Repo.get_by(Device, id: id, user_id: user.id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})

      device ->
        Repo.delete(device)
        json(conn, %{ok: true})
    end
  end

  def update_push_token(conn, %{"id" => id, "push_token" => token}) do
    user = Plug.current_resource(conn)

    case Repo.get_by(Device, id: id, user_id: user.id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})

      device ->
        device
        |> Device.changeset(%{push_token: token})
        |> Repo.update()

        json(conn, %{ok: true})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
