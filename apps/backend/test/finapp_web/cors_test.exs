defmodule FinappWeb.CorsTest do
  @moduledoc """
  Regression tests for CORS preflight handling.

  CORS preflights (OPTIONS requests) must be handled at the endpoint level,
  not inside a router pipeline — pipeline plugs only run after a route is
  matched, so an OPTIONS request to any path would otherwise return 404 before
  Corsica could respond, causing browsers to report "Failed to fetch".

  These tests do not require a database connection.
  """

  use FinappWeb.ConnCase, async: true

  @allowed_origins [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://app.fresh.app"
  ]

  defp preflight(path, origin, request_method \\ "POST", request_headers \\ "content-type") do
    build_conn()
    |> put_req_header("origin", origin)
    |> put_req_header("access-control-request-method", request_method)
    |> put_req_header("access-control-request-headers", request_headers)
    |> options(path)
  end

  # ---------------------------------------------------------------------------
  # Preflight returns 200 (not 404) for all allowed origins
  # ---------------------------------------------------------------------------

  describe "CORS preflight — public endpoints" do
    for origin <- @allowed_origins do
      @origin origin
      test "OPTIONS /api/v1/auth/register returns 200 from #{origin}" do
        assert preflight("/api/v1/auth/register", @origin).status == 200
      end

      test "OPTIONS /api/v1/auth/login returns 200 from #{origin}" do
        assert preflight("/api/v1/auth/login", @origin).status == 200
      end
    end
  end

  describe "CORS preflight — authenticated endpoints" do
    for origin <- @allowed_origins do
      @origin origin
      test "OPTIONS /api/v1/users/me returns 200 from #{origin}" do
        assert preflight("/api/v1/users/me", @origin, "DELETE", "authorization").status == 200
      end

      test "OPTIONS /api/v1/devices returns 200 from #{origin}" do
        assert preflight("/api/v1/devices", @origin).status == 200
      end
    end
  end

  # ---------------------------------------------------------------------------
  # CORS response headers are present and correct
  # ---------------------------------------------------------------------------

  describe "CORS response headers" do
    test "preflight includes Access-Control-Allow-Origin for allowed origin" do
      resp = preflight("/api/v1/auth/register", "http://localhost:5173")
      assert get_resp_header(resp, "access-control-allow-origin") == ["http://localhost:5173"]
    end

    test "preflight includes Access-Control-Allow-Headers with content-type" do
      resp = preflight("/api/v1/auth/register", "http://localhost:5173")
      allowed = resp |> get_resp_header("access-control-allow-headers") |> Enum.join(",") |> String.downcase()
      assert String.contains?(allowed, "content-type")
    end

    test "preflight includes Access-Control-Allow-Headers with authorization" do
      resp = preflight("/api/v1/users/me", "http://localhost:5173", "DELETE", "authorization")
      allowed = resp |> get_resp_header("access-control-allow-headers") |> Enum.join(",") |> String.downcase()
      assert String.contains?(allowed, "authorization")
    end

    test "preflight includes Access-Control-Allow-Credentials: true" do
      resp = preflight("/api/v1/auth/login", "http://localhost:5173")
      assert get_resp_header(resp, "access-control-allow-credentials") == ["true"]
    end

    test "actual POST to login includes CORS origin header for allowed origin" do
      resp =
        build_conn()
        |> put_req_header("origin", "http://localhost:5173")
        |> put_req_header("content-type", "application/json")
        |> post("/api/v1/auth/login", %{"email" => "x@x.com", "password" => "bad"})

      assert get_resp_header(resp, "access-control-allow-origin") == ["http://localhost:5173"]
    end
  end

  # ---------------------------------------------------------------------------
  # Disallowed origins do not receive CORS headers
  # ---------------------------------------------------------------------------

  describe "CORS disallowed origins" do
    test "preflight from disallowed origin does not get allow-origin header" do
      resp = preflight("/api/v1/auth/register", "https://evil.example.com")
      assert get_resp_header(resp, "access-control-allow-origin") == []
    end

    test "actual request from disallowed origin does not get allow-origin header" do
      resp =
        build_conn()
        |> put_req_header("origin", "https://evil.example.com")
        |> post("/api/v1/auth/login", %{"email" => "x@x.com", "password" => "bad"})

      assert get_resp_header(resp, "access-control-allow-origin") == []
    end
  end
end
