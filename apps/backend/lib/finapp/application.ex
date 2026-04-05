defmodule Finapp.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Finapp.Repo,
      {DNSCluster, query: Application.get_env(:finapp, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Finapp.PubSub},
      {Oban, Application.fetch_env!(:finapp, Oban)},
      {Redix, {Application.get_env(:finapp, :redis_url, "redis://localhost:6379"), [name: :redix]}},
      Finapp.Vault,
      FinappWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Finapp.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    FinappWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
