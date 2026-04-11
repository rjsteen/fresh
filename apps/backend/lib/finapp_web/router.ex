defmodule FinappWeb.Router do
  use Phoenix.Router, helpers: false

  import Plug.Conn
  import Phoenix.Controller

  pipeline :api do
    plug :accepts, ["json"]
    plug FinappWeb.Plugs.RateLimiter
  end

  pipeline :authenticated do
    plug FinappWeb.Plugs.AuthPipeline
  end

  pipeline :sidecar_auth do
    plug FinappWeb.Plugs.SidecarAuth
  end

  scope "/api/v1", FinappWeb do
    pipe_through :api

    post "/auth/register", AuthController, :register
    post "/auth/login", AuthController, :login
    post "/auth/refresh", AuthController, :refresh
  end

  scope "/api/v1", FinappWeb do
    pipe_through [:api, :authenticated]

    # Account management
    patch "/users/me", UserController, :update
    delete "/users/me", UserController, :delete

    # Device management
    post "/devices", DeviceController, :register
    delete "/devices/:id", DeviceController, :deregister
    put "/devices/:id/push-token", DeviceController, :update_push_token

    # Bank connections — these endpoints handle setup tokens only, never raw credentials
    post "/connections/simplefin/claim", ConnectionController, :simplefin_claim
    post "/connections/gocardless/requisition", ConnectionController, :gocardless_requisition
    get "/connections/gocardless/requisition/:id/status", ConnectionController, :gocardless_status
    delete "/connections/:id", ConnectionController, :disconnect

    # Sync schedule management
    get "/sync/jobs", SyncController, :list_jobs
    post "/sync/jobs/:id/trigger", SyncController, :trigger_now
    put "/sync/jobs/:id/schedule", SyncController, :update_schedule

    # Model distribution — devices pull new weights after model:updated signal
    get "/models/current", ModelController, :current_versions
  end

  # Internal endpoints — sidecar only, validated by X-Internal-Token header
  scope "/internal", FinappWeb do
    pipe_through [:api, :sidecar_auth]

    post "/models/notify", ModelController, :notify
  end

  # Health check — no auth required
  scope "/health" do
    pipe_through :api
    get "/", FinappWeb.HealthController, :check
  end
end
