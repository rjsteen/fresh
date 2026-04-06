defmodule FinappWeb.ConnCase do
  @moduledoc """
  Test case for controller/plug tests. Checks out an Ecto sandbox connection
  and provides a Phoenix.ConnTest conn.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Plug.Conn
      import Phoenix.ConnTest

      import Ecto.Query

      use Oban.Testing, repo: Finapp.Repo

      alias Finapp.Repo

      @endpoint FinappWeb.Endpoint

      @valid_token Application.compile_env!(:finapp, :sidecar_token)
    end
  end

  setup tags do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Finapp.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end
end
