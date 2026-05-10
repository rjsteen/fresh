defmodule FinappWeb.ModelControllerNotifyTest do
  use FinappWeb.ConnCase, async: true

  import Ecto.Query

  @checksum String.duplicate("a", 64)

  defp authed(conn), do: put_req_header(conn, "x-internal-token", @valid_token)

  defp notify(conn, params) do
    post(conn |> authed(), "/internal/models/notify", params)
  end

  defp valid_params(overrides \\ %{}) do
    Map.merge(
      %{
        "model_type" => "categorizer",
        "version" => "1.0.0",
        "cdn_path" => "models/categorizer/1.0.0/model.onnx",
        "checksum_sha256" => @checksum
      },
      overrides
    )
  end

  describe "POST /internal/models/notify" do
    test "returns 200 with version on success", %{conn: conn} do
      resp = notify(conn, valid_params())
      assert json_response(resp, 200) == %{"version" => "1.0.0"}
    end

    test "inserts a model_versions row marked as current", %{conn: conn} do
      notify(conn, valid_params())

      row =
        Repo.one(
          from mv in "model_versions",
            where: mv.model_type == "categorizer" and mv.version == "1.0.0",
            select: %{
              version: mv.version,
              cdn_path: mv.cdn_path,
              checksum_sha256: mv.checksum_sha256,
              is_current: mv.is_current
            }
        )

      assert row.version == "1.0.0"
      assert row.cdn_path == "models/categorizer/1.0.0/model.onnx"
      assert row.checksum_sha256 == @checksum
      assert row.is_current == true
    end

    test "marks the previous current version as not current", %{conn: conn} do
      # First version
      notify(conn, valid_params(%{"version" => "0.9.0", "cdn_path" => "models/categorizer/0.9.0/model.onnx"}))

      # Second version replaces it
      notify(conn, valid_params(%{"version" => "1.0.0"}))

      old =
        Repo.one(
          from mv in "model_versions",
            where: mv.model_type == "categorizer" and mv.version == "0.9.0",
            select: mv.is_current
        )

      current =
        Repo.one(
          from mv in "model_versions",
            where: mv.model_type == "categorizer" and mv.version == "1.0.0",
            select: mv.is_current
        )

      assert old == false
      assert current == true
    end

    test "versions for different model types are independent", %{conn: conn} do
      notify(conn, valid_params(%{"model_type" => "categorizer", "version" => "1.0.0"}))
      notify(conn, valid_params(%{"model_type" => "anomaly", "version" => "2.0.0",
                                  "cdn_path" => "models/anomaly/2.0.0/model.onnx"}))

      cat_current =
        Repo.one(
          from mv in "model_versions",
            where: mv.model_type == "categorizer" and mv.is_current == true,
            select: mv.version
        )

      ano_current =
        Repo.one(
          from mv in "model_versions",
            where: mv.model_type == "anomaly" and mv.is_current == true,
            select: mv.version
        )

      assert cat_current == "1.0.0"
      assert ano_current == "2.0.0"
    end

    test "re-notifying the same version updates cdn_path and checksum", %{conn: conn} do
      notify(conn, valid_params())
      updated_checksum = String.duplicate("b", 64)

      notify(conn, valid_params(%{
        "cdn_path" => "models/categorizer/1.0.0/model-v2.onnx",
        "checksum_sha256" => updated_checksum
      }))

      row =
        Repo.one(
          from mv in "model_versions",
            where: mv.model_type == "categorizer" and mv.version == "1.0.0",
            select: %{cdn_path: mv.cdn_path, checksum_sha256: mv.checksum_sha256, is_current: mv.is_current}
        )

      assert row.cdn_path == "models/categorizer/1.0.0/model-v2.onnx"
      assert row.checksum_sha256 == updated_checksum
      assert row.is_current == true
    end

    test "enqueues a ModelDistributionWorker job", %{conn: conn} do
      notify(conn, valid_params())

      assert_enqueued(
        worker: Finapp.ML.ModelDistributionWorker,
        args: %{
          "model_type" => "categorizer",
          "version" => "1.0.0",
          "cdn_path" => "models/categorizer/1.0.0/model.onnx",
          "checksum_sha256" => @checksum
        }
      )
    end
  end
end
