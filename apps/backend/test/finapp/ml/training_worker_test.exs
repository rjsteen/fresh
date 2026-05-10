defmodule Finapp.ML.TrainingWorkerTest do
  use FinappWeb.ConnCase, async: true

  import Ecto.Query

  alias Finapp.ML.{TrainingExample, TrainingWorker}

  @input_dim 100

  defp features, do: Enum.map(1..@input_dim, fn i -> i / 100.0 end)

  defp insert_example(attrs \\ %{}) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    defaults = %{
      id: Ecto.UUID.generate(),
      model_type: "categorizer",
      features: features(),
      label: "cat-groceries",
      exported_at: nil,
      inserted_at: now,
      updated_at: now
    }

    Repo.insert_all(TrainingExample, [Map.merge(defaults, attrs)])
    defaults.id
  end

  defp perform, do: TrainingWorker.perform(%Oban.Job{args: %{}})

  describe "perform/1 with no unexported examples" do
    test "returns :ok without calling sidecar" do
      Req.Test.stub(Finapp.ML.SidecarClient, fn _conn ->
        flunk("sidecar should not be called when there are no unexported examples")
      end)

      assert :ok = perform()
    end
  end

  describe "perform/1 with unexported examples" do
    test "marks examples as exported after successful training" do
      id = insert_example(%{label: "cat-groceries"})
      insert_example(%{id: Ecto.UUID.generate(), label: "cat-dining"})

      Req.Test.expect(Finapp.ML.SidecarClient, 2, fn conn ->
        cond do
          String.ends_with?(conn.request_path, "/training-data") ->
            Plug.Conn.send_resp(conn, 204, "")

          String.ends_with?(conn.request_path, "/train") ->
            body =
              Jason.encode!(%{
                model_type: "categorizer",
                version: "20260509-abc12345",
                cdn_path: "models/categorizer/20260509-abc12345/model.onnx",
                checksum_sha256: String.duplicate("a", 64),
                num_examples: 2,
                num_classes: 2
              })

            conn
            |> Plug.Conn.put_resp_content_type("application/json")
            |> Plug.Conn.send_resp(200, body)
        end
      end)

      assert :ok = perform()

      exported_ids =
        Repo.all(
          from e in TrainingExample,
            where: not is_nil(e.exported_at),
            select: e.id
        )

      assert id in exported_ids
    end

    test "does not mark examples as exported when sidecar returns not_enough_data" do
      id = insert_example()

      Req.Test.expect(Finapp.ML.SidecarClient, 2, fn conn ->
        cond do
          String.ends_with?(conn.request_path, "/training-data") ->
            Plug.Conn.send_resp(conn, 204, "")

          String.ends_with?(conn.request_path, "/train") ->
            body =
              Jason.encode!(%{detail: "Need at least 10 accumulated training examples for categorizer (have 1). Send data via POST /training-data first."})

            conn
            |> Plug.Conn.put_resp_content_type("application/json")
            |> Plug.Conn.send_resp(400, body)
        end
      end)

      assert :ok = perform()

      still_unexported =
        Repo.one(from e in TrainingExample, where: e.id == ^id, select: e.exported_at)

      assert is_nil(still_unexported)
    end

    test "skips already-exported examples" do
      now = DateTime.utc_now() |> DateTime.truncate(:second)
      insert_example(%{exported_at: now})

      Req.Test.stub(Finapp.ML.SidecarClient, fn _conn ->
        flunk("should not call sidecar when all examples are already exported")
      end)

      assert :ok = perform()
    end

    test "returns error when sidecar /training-data fails" do
      insert_example()

      Req.Test.stub(Finapp.ML.SidecarClient, fn conn ->
        body = Jason.encode!(%{detail: "internal error"})

        conn
        |> Plug.Conn.put_resp_content_type("application/json")
        |> Plug.Conn.send_resp(500, body)
      end)

      assert {:error, {:http_error, 500}} = perform()
    end
  end
end
