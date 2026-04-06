defmodule FinappWeb.ModelControllerCurrentTest do
  use FinappWeb.ConnCase, async: true

  @checksum String.duplicate("a", 64)
  @cdn_base Application.compile_env!(:finapp, :cdn_base_url)

  defp authed(conn) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    {:ok, user} =
      Repo.insert(
        Finapp.Accounts.User.registration_changeset(%Finapp.Accounts.User{}, %{
          "email" => "model-test-#{System.unique_integer([:positive])}@example.com",
          "password" => "Password1!"
        })
      )

    {:ok, token, _} = Finapp.Guardian.build_token(user)
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  defp insert_model(overrides \\ %{}) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    defaults = %{
      id: Ecto.UUID.bingenerate(),
      model_type: "categorizer",
      version: "1.0.0",
      cdn_path: "models/categorizer/1.0.0/model.onnx",
      checksum_sha256: @checksum,
      is_current: true,
      deployed_at: now,
      inserted_at: now,
      updated_at: now
    }

    Repo.insert_all("model_versions", [Map.merge(defaults, overrides)])
  end

  describe "GET /api/v1/models/current" do
    test "returns 401 without auth", %{conn: conn} do
      resp = get(conn, "/api/v1/models/current")
      assert resp.status == 401
    end

    test "returns empty list when no current versions exist", %{conn: conn} do
      resp = get(conn |> authed(), "/api/v1/models/current")
      assert json_response(resp, 200) == %{"models" => []}
    end

    test "returns version, cdn_url, and checksum for a current model", %{conn: conn} do
      insert_model()

      resp = get(conn |> authed(), "/api/v1/models/current")
      body = json_response(resp, 200)

      assert [model] = body["models"]
      assert model["model_type"] == "categorizer"
      assert model["version"] == "1.0.0"
      assert model["cdn_url"] == "#{@cdn_base}/models/categorizer/1.0.0/model.onnx"
      assert model["checksum"] == @checksum
      refute Map.has_key?(model, "cdn_path")
      refute Map.has_key?(model, "checksum_sha256")
    end

    test "excludes rows where is_current is false", %{conn: conn} do
      insert_model(%{version: "0.9.0", is_current: false,
                     cdn_path: "models/categorizer/0.9.0/model.onnx"})
      insert_model(%{version: "1.0.0", is_current: true})

      resp = get(conn |> authed(), "/api/v1/models/current")
      body = json_response(resp, 200)

      assert [model] = body["models"]
      assert model["version"] == "1.0.0"
    end

    test "returns current versions for both model types independently", %{conn: conn} do
      insert_model(%{model_type: "categorizer", version: "1.0.0",
                     cdn_path: "models/categorizer/1.0.0/model.onnx"})
      insert_model(%{model_type: "anomaly_detector", version: "2.0.0",
                     cdn_path: "models/anomaly_detector/2.0.0/model.onnx"})

      resp = get(conn |> authed(), "/api/v1/models/current")
      body = json_response(resp, 200)

      assert length(body["models"]) == 2
      types = Enum.map(body["models"], & &1["model_type"]) |> Enum.sort()
      assert types == ["anomaly_detector", "categorizer"]
    end
  end
end
