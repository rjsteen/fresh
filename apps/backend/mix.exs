defmodule Finapp.MixProject do
  use Mix.Project

  def project do
    [
      app: :finapp,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps()
    ]
  end

  def application do
    [
      mod: {Finapp.Application, []},
      extra_applications: [:logger, :runtime_tools, :crypto]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # Phoenix
      {:phoenix, "~> 1.7.14"},
      {:phoenix_pubsub, "~> 2.1"},
      {:phoenix_ecto, "~> 4.6"},
      {:ecto_sql, "~> 3.12"},
      {:postgrex, ">= 0.0.0"},
      {:bandit, "~> 1.5"},

      # Auth & security
      {:guardian, "~> 2.3"},
      {:bcrypt_elixir, "~> 3.0"},
      {:corsica, "~> 2.1"},

      # Background jobs
      {:oban, "~> 2.18"},

      # HTTP client
      {:req, "~> 0.5"},

      # Encryption (for transit-only token encryption)
      {:cloak, "~> 1.1"},
      {:cloak_ecto, "~> 1.3"},

      # Redis (for rate limiting and distributed locks)
      {:redix, "~> 1.5"},
      {:ex_rated, "~> 2.1"},

      # Monitoring
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.1"},

      # Dev/test
      {:jason, "~> 1.4"},
      {:dns_cluster, "~> 0.1.3"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:ex_machina, "~> 2.8", only: :test},
      {:mox, "~> 1.2", only: :test}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
    ]
  end
end
