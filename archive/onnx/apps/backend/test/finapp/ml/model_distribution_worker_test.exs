defmodule Finapp.ML.ModelDistributionWorkerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.ML.ModelDistributionWorker

  @checksum String.duplicate("a", 64)

  defp perform(args \\ %{}) do
    ModelDistributionWorker.perform(%Oban.Job{args: args})
  end

  defp insert_model_version(attrs) do
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

    Repo.insert_all("model_versions", [Map.merge(defaults, attrs)])
  end

  describe "perform/1 with explicit args (triggered by sidecar)" do
    test "broadcasts model:updated to PubSub", %{conn: _conn} do
      Phoenix.PubSub.subscribe(Finapp.PubSub, "model_updates")

      assert :ok =
               perform(%{
                 "model_type" => "categorizer",
                 "version" => "1.0.0",
                 "cdn_path" => "models/categorizer/1.0.0/model.onnx",
                 "checksum_sha256" => @checksum
               })

      assert_receive {:model_updated, payload}, 1000
      assert payload.model_type == "categorizer"
      assert payload.version == "1.0.0"
      assert payload.cdn_path == "models/categorizer/1.0.0/model.onnx"
      assert payload.checksum_sha256 == @checksum
    end
  end

  describe "perform/1 with no args (cron schedule)" do
    test "broadcasts model:updated for each current model version", %{conn: _conn} do
      Phoenix.PubSub.subscribe(Finapp.PubSub, "model_updates")

      insert_model_version(%{model_type: "categorizer", version: "2.0.0"})
      insert_model_version(%{
        id: Ecto.UUID.bingenerate(),
        model_type: "anomaly",
        version: "1.5.0",
        cdn_path: "models/anomaly/1.5.0/model.onnx"
      })

      assert :ok = perform()

      received =
        for _ <- 1..2 do
          assert_receive {:model_updated, payload}, 1000
          payload.model_type
        end

      assert Enum.sort(received) == ["anomaly", "categorizer"]
    end

    test "broadcasts nothing when no current models exist", %{conn: _conn} do
      Phoenix.PubSub.subscribe(Finapp.PubSub, "model_updates")

      assert :ok = perform()

      refute_receive {:model_updated, _}, 100
    end
  end
end
