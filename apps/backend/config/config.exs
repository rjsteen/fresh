import Config

config :finapp,
  ecto_repos: [Finapp.Repo],
  generators: [timestamp_type: :utc_datetime]

config :finapp, FinappWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: FinappWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Finapp.PubSub,
  live_view: [signing_salt: "REPLACE_ME"]

config :finapp, Finapp.PubSub,
  name: Finapp.PubSub,
  adapter: Phoenix.PubSub.PG2

# Oban — background job processing
config :finapp, Oban,
  repo: Finapp.Repo,
  plugins: [
    {Oban.Plugins.Pruner, max_age: 60 * 60 * 24 * 7},   # 7 days
    {Oban.Plugins.Cron,
     crontab: [
       # Model distribution check — every 6 hours
       {"0 */6 * * *", Finapp.ML.ModelDistributionWorker},
       # Stale device cleanup — daily at 3 AM
       {"0 3 * * *", Finapp.Accounts.StaleDeviceWorker}
     ]}
  ],
  queues: [
    bank_sync: [limit: 10],       # Bank API polling jobs
    notifications: [limit: 20],   # Push notification delivery
    model_dist: [limit: 2]        # Model weight distribution
  ]

# Guardian — JWT auth (no session cookies; this is an API-only backend)
config :finapp, Finapp.Guardian,
  issuer: "finapp",
  secret_key: {:system, "GUARDIAN_SECRET_KEY"}

# Cloak — field-level encryption for sync tokens stored in Postgres
config :finapp, Finapp.Vault,
  ciphers: [
    default: {
      Cloak.Ciphers.AES.GCM,
      tag: "AES.GCM.V1",
      key: {:system, "CLOAK_KEY_BASE64"},
      iv_length: 12
    }
  ]

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id, :user_id, :device_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
