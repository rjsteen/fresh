import Config

config :finapp, Finapp.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "finapp_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

config :finapp, FinappWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test-secret-key-base-replace-me",
  server: false

config :finapp, Finapp.Guardian,
  secret_key: "test-guardian-secret"

config :finapp, Finapp.Vault,
  ciphers: [
    default: {
      Cloak.Ciphers.AES.GCM,
      tag: "AES.GCM.V1",
      key: Base.decode64!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
      iv_length: 12
    }
  ]

config :finapp, Finapp.Sync.SimpleFin, req_plug: {Req.Test, Finapp.Sync.SimpleFin}

config :finapp, :sidecar_token, "test-sidecar-token"
config :finapp, :cdn_base_url, "https://cdn.test.example.com"

config :finapp, Oban, repo: Finapp.Repo, testing: :manual

config :logger, level: :warning
