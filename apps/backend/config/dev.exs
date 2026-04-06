import Config

config :finapp, Finapp.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "finapp_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :finapp, FinappWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "LOCAL_DEV_SECRET_KEY_BASE_NOT_FOR_PRODUCTION_USE_AT_ALL",
  watchers: []

config :finapp, Finapp.Guardian,
  secret_key: "local-dev-guardian-secret-replace-in-prod"

config :finapp, Finapp.Vault,
  ciphers: [
    default: {
      Cloak.Ciphers.AES.GCM,
      tag: "AES.GCM.V1",
      # 32-byte key, base64-encoded
      key: Base.decode64!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
      iv_length: 12
    }
  ]

# Redis — local Docker instance
config :finapp, :redis_url, "redis://localhost:6379"

# SimpleFIN sandbox — use test credentials in dev
config :finapp, :simplefin,
  base_url: "https://bridge.simplefin.org",
  sandbox: true

# GoCardless sandbox
config :finapp, :gocardless,
  base_url: "https://bankaccountdata.gocardless.com",
  sandbox: true

# ML sidecar
config :finapp, :ml_sidecar_url, "http://localhost:8001"
config :finapp, :sidecar_token, "dev-sidecar-token"

# CDN base for model weight distribution
config :finapp, :cdn_base_url, "http://localhost:9000/finapp-models"

config :logger, level: :debug
