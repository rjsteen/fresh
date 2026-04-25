defmodule Finapp.Notifications.PushWorker do
  @moduledoc """
  Oban worker that delivers a push notification to all devices registered to
  a given user.

  Required args:
    - "user_id"  — the user whose devices receive the notification
    - "title"    — notification title string
    - "body"     — notification body string

  Optional args:
    - "data"     — map forwarded to the app's notification handler (for deep-linking)

  If the user has no devices with a push token the job returns `:ok`
  immediately. `DeviceNotRegistered` ticket errors are handled by
  `PushDispatcher` (it clears the stale token from the DB).
  """

  use Oban.Worker, queue: :notifications, max_attempts: 3

  import Ecto.Query
  alias Finapp.{Accounts.Device, Notifications.PushDispatcher, Repo}

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id, "title" => title, "body" => body} = args}) do
    tokens =
      Repo.all(
        from d in Device,
          where: d.user_id == ^user_id and not is_nil(d.push_token),
          select: d.push_token
      )

    notification = %{
      title: title,
      body: body,
      data: args["data"] || %{}
    }

    PushDispatcher.push(tokens, notification)
  end
end
