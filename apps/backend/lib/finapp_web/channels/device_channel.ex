defmodule FinappWeb.DeviceChannel do
  @moduledoc """
  The sole Phoenix Channel. Handles signal delivery to devices.

  Messages sent TO the server: device lifecycle, alert token registration.
  Messages sent FROM the server: sync signals, alert signals, model update signals.

  Financial data NEVER flows through this channel.
  """

  use Phoenix.Channel
  alias Finapp.Accounts
  alias Finapp.Repo

  @impl true
  def join("device:me", _params, socket) do
    user_id = socket.assigns.current_user_id

    # Subscribe to this user's PubSub topic so Oban workers can broadcast to us
    Phoenix.PubSub.subscribe(Finapp.PubSub, "user:#{user_id}")

    # Touch the device's last_seen_at
    touch_device(socket)

    {:ok, %{status: "connected"}, socket}
  end

  # Client acknowledges a completed sync pull
  @impl true
  def handle_in("sync:ack", %{"account_token_ref" => ref}, socket) do
    # Update the sync job's last_success_at via the token ref
    Finapp.Sync.ack_sync(ref, socket.assigns.current_user_id)
    {:noreply, socket}
  end

  # Client registers an alert rule token so backend can route push notifications
  @impl true
  def handle_in("alert:register", %{"rule_token_ref" => ref}, socket) do
    user_id = socket.assigns.current_user_id
    Accounts.add_alert_token(user_id, ref)
    {:noreply, socket}
  end

  # Client deregisters an alert rule token (user deleted the rule)
  @impl true
  def handle_in("alert:deregister", %{"rule_token_ref" => ref}, socket) do
    user_id = socket.assigns.current_user_id
    Accounts.remove_alert_token(user_id, ref)
    {:noreply, socket}
  end

  # ---------------------------------------------------------------------------
  # PubSub → Channel bridge
  # Messages arriving from Oban workers via Phoenix.PubSub
  # ---------------------------------------------------------------------------

  @impl true
  def handle_info({:sync_complete, payload}, socket) do
    push(socket, "sync:complete", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:sync_error, payload}, socket) do
    push(socket, "sync:error", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:alert_triggered, payload}, socket) do
    # payload contains only the opaque rule_token_ref — never the rule content
    push(socket, "alert:triggered", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:model_updated, payload}, socket) do
    push(socket, "model:updated", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:rules_updated, payload}, socket) do
    push(socket, "rules:updated", payload)
    {:noreply, socket}
  end

  defp touch_device(socket) do
    user_id = socket.assigns.current_user_id
    # Fire and forget — don't block the join on a DB write
    Task.start(fn ->
      case Accounts.get_device_by_user(user_id) do
        nil -> :ok
        device ->
          device
          |> Finapp.Accounts.Device.touch_changeset()
          |> Repo.update()
      end
    end)
  end
end
