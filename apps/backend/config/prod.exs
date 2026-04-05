import Config

config :finapp, FinappWeb.Endpoint,
  cache_static_manifest: "priv/static/cache_manifest.json",
  server: true

config :logger, level: :info

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id, :user_id, :device_id]

# Use DNS-based clustering for Hetzner VPS fleet (libcluster)
config :finapp, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

config :libcluster,
  topologies: [
    finapp: [
      strategy: Cluster.Strategy.DNSPoll,
      config: [
        query: System.get_env("DNS_CLUSTER_QUERY") || "finapp.internal",
        node_basename: "finapp"
      ]
    ]
  ]
