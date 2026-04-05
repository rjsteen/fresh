defmodule Finapp.Repo do
  use Ecto.Repo,
    otp_app: :finapp,
    adapter: Ecto.Adapters.Postgres
end
