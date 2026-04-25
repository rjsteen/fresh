defmodule FinappWeb.ChannelCase do
  @moduledoc """
  Test case for Phoenix Channel tests. Checks out an Ecto sandbox and
  provides Phoenix.ChannelTest helpers.
  """

  use ExUnit.CaseTemplate

  alias Ecto.Adapters.SQL.Sandbox

  using do
    quote do
      import Phoenix.ChannelTest
      import Ecto.Query

      use Oban.Testing, repo: Finapp.Repo

      alias Finapp.Repo

      @endpoint FinappWeb.Endpoint
    end
  end

  setup tags do
    pid = Sandbox.start_owner!(Finapp.Repo, shared: not tags[:async])
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end
end
