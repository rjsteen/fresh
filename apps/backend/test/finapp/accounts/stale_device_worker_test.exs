defmodule Finapp.Accounts.StaleDeviceWorkerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.{Device, StaleDeviceWorker, User}

  defp create_user(email \\ "stale@example.com") do
    Repo.insert!(User.registration_changeset(%User{}, %{"email" => email, "password" => "password123"}))
  end

  defp insert_device(user, last_seen_at) do
    Repo.insert!(
      Device.changeset(%Device{}, %{
        name: "Test Device",
        platform: "ios",
        user_id: user.id
      })
      |> Ecto.Changeset.put_change(:last_seen_at, last_seen_at)
    )
  end

  defp perform do
    StaleDeviceWorker.perform(%Oban.Job{args: %{}})
  end

  describe "perform/1" do
    test "deletes devices not seen in more than 90 days", %{conn: _conn} do
      user = create_user()
      cutoff = DateTime.utc_now() |> DateTime.add(-91, :day) |> DateTime.truncate(:second)
      stale_device = insert_device(user, cutoff)

      assert :ok = perform()

      assert Repo.get(Device, stale_device.id) == nil
    end

    test "deletes devices with nil last_seen_at", %{conn: _conn} do
      user = create_user("nil-seen@example.com")
      never_seen = Repo.insert!(Device.changeset(%Device{}, %{name: "Never Seen", platform: "web", user_id: user.id}))

      assert :ok = perform()

      assert Repo.get(Device, never_seen.id) == nil
    end

    test "keeps devices seen within the last 90 days", %{conn: _conn} do
      user = create_user("recent@example.com")
      recent_at = DateTime.utc_now() |> DateTime.add(-1, :day) |> DateTime.truncate(:second)
      recent_device = insert_device(user, recent_at)

      assert :ok = perform()

      assert Repo.get(Device, recent_device.id) != nil
    end

    test "keeps devices seen exactly on the 90-day boundary", %{conn: _conn} do
      user = create_user("boundary@example.com")
      boundary = DateTime.utc_now() |> DateTime.add(-90, :day) |> DateTime.truncate(:second)
      boundary_device = insert_device(user, boundary)

      assert :ok = perform()

      # Equal to cutoff is NOT strictly less-than, so device is kept
      assert Repo.get(Device, boundary_device.id) != nil
    end

    test "removes stale devices without affecting recent ones", %{conn: _conn} do
      user = create_user("mixed@example.com")
      old_at = DateTime.utc_now() |> DateTime.add(-95, :day) |> DateTime.truncate(:second)
      new_at = DateTime.utc_now() |> DateTime.add(-5, :day) |> DateTime.truncate(:second)

      old_device = insert_device(user, old_at)
      new_device = insert_device(user, new_at)

      assert :ok = perform()

      assert Repo.get(Device, old_device.id) == nil
      assert Repo.get(Device, new_device.id) != nil
    end
  end
end
