defmodule FinappWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :finapp

  # Phoenix Channels WebSocket — declared here, not in the router
  socket "/socket", FinappWeb.UserSocket,
    websocket: [timeout: 45_000, compress: true],
    longpoll: false

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Corsica,
    origins: [
      "https://app.fresh.app",
      ~r/^http:\/\/localhost:\d+$/
    ],
    allow_credentials: true,
    allow_headers: ["authorization", "content-type", "x-device-id"],
    max_age: 600

  plug Plug.MethodOverride
  plug Plug.Head
  plug FinappWeb.Router
end
