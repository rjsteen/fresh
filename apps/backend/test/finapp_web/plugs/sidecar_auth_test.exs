defmodule FinappWeb.Plugs.SidecarAuthTest do
  use FinappWeb.ConnCase, async: true

  describe "SidecarAuth plug" do
    test "passes through with correct token", %{conn: conn} do
      conn =
        conn
        |> put_req_header("x-internal-token", @valid_token)
        |> post("/internal/models/notify", %{
          "model_type" => "categorizer",
          "version" => "1.0.0",
          "cdn_path" => "models/categorizer/1.0.0/model.onnx",
          "checksum_sha256" => String.duplicate("a", 64)
        })

      # If auth passed, we get a 200 (not a 401)
      assert conn.status == 200
    end

    test "returns 401 with wrong token", %{conn: conn} do
      conn =
        conn
        |> put_req_header("x-internal-token", "wrong-token")
        |> post("/internal/models/notify", %{})

      assert conn.status == 401
      assert json_response(conn, 401)["error"] == "unauthorized"
    end

    test "returns 401 with no token", %{conn: conn} do
      conn = post(conn, "/internal/models/notify", %{})

      assert conn.status == 401
      assert json_response(conn, 401)["error"] == "unauthorized"
    end

    test "halts on auth failure — body not processed", %{conn: conn} do
      conn =
        conn
        |> put_req_header("x-internal-token", "bad")
        |> post("/internal/models/notify", %{"model_type" => "categorizer"})

      assert conn.halted
    end
  end
end
