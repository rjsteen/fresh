import Config

# ---------------------------------------------------------------------------
# Overrides that apply in any environment when running outside local dev
# (i.e. inside Docker or any deployment where env vars are explicitly set).
# ---------------------------------------------------------------------------

# Bind to 0.0.0.0 when PORT is set so Docker port-forwarding can reach the
# process. dev.exs defaults to 127.0.0.1 (container loopback only), which
# causes ERR_CONNECTION_RESET for requests coming from the host.
if port = System.get_env("PORT") do
  config :finapp, FinappWeb.Endpoint,
    http: [ip: {0, 0, 0, 0}, port: String.to_integer(port)]
end

# Use DATABASE_URL when provided so Docker services reach the postgres
# container by hostname rather than falling back to dev.exs "localhost".
# Also allows POOL_SIZE tuning — the default of 10 is too small when Oban
# queues (bank_sync: 10, notifications: 20, model_dist: 2) compete with web
# requests for the same pool.
if database_url = System.get_env("DATABASE_URL") do
  config :finapp, Finapp.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "20")
end

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise "DATABASE_URL environment variable is not set"

  config :finapp, Finapp.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    ssl: true,
    ssl_opts: [verify: :verify_none]

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE environment variable is not set"

  host = System.get_env("PHX_HOST") || raise "PHX_HOST not set"
  port = String.to_integer(System.get_env("PORT") || "4000")

  config :finapp, FinappWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0}, port: port],
    secret_key_base: secret_key_base

  config :finapp, Finapp.Guardian,
    secret_key: System.get_env("GUARDIAN_SECRET_KEY") || raise("GUARDIAN_SECRET_KEY not set")

  cloak_key =
    System.get_env("CLOAK_KEY_BASE64") ||
      raise "CLOAK_KEY_BASE64 environment variable is not set"

  config :finapp, Finapp.Vault,
    ciphers: [
      default: {
        Cloak.Ciphers.AES.GCM,
        tag: "AES.GCM.V1",
        key: Base.decode64!(cloak_key),
        iv_length: 12
      }
    ]

  config :finapp, :redis_url,
    System.get_env("REDIS_URL") || raise("REDIS_URL not set")

  config :finapp, :simplefin,
    base_url: "https://bridge.simplefin.org",
    sandbox: false

  config :finapp, :gocardless,
    base_url: "https://bankaccountdata.gocardless.com",
    sandbox: false

  config :finapp, :ml_sidecar_url,
    System.get_env("ML_SIDECAR_URL") || raise("ML_SIDECAR_URL not set")

  config :finapp, :sidecar_token,
    System.get_env("SIDECAR_TOKEN") || raise("SIDECAR_TOKEN not set")

  config :finapp, :cdn_base_url,
    System.get_env("CDN_BASE_URL") || raise("CDN_BASE_URL not set")
end
