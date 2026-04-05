import Config

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

  config :finapp, :cdn_base_url,
    System.get_env("CDN_BASE_URL") || raise("CDN_BASE_URL not set")
end
