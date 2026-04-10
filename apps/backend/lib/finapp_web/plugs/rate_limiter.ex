defmodule FinappWeb.Plugs.RateLimiter do
  @moduledoc false

  import Plug.Conn
  import Phoenix.Controller

  @limits %{
    "/api/v1/auth/login"    => {10, 60_000},   # 10 req/min
    "/api/v1/auth/register" => {5, 60_000},    # 5 req/min
    :default                => {100, 60_000}   # 100 req/min default
  }

  def init(opts), do: opts

  def call(conn, _opts) do
    key = rate_limit_key(conn)
    {limit, window_ms} = Map.get(@limits, conn.request_path, @limits[:default])

    case ExRated.check_rate(key, window_ms, limit) do
      {:ok, _count} ->
        conn

      {:error, _limit} ->
        conn
        |> put_status(:too_many_requests)
        |> json(%{error: "rate_limited", retry_after_ms: window_ms})
        |> halt()
    end
  end

  defp rate_limit_key(conn) do
    ip =
      conn.remote_ip
      |> Tuple.to_list()
      |> Enum.join(".")

    "#{ip}:#{conn.request_path}"
  end
end
