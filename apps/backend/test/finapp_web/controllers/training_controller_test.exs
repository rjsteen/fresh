defmodule FinappWeb.TrainingControllerTest do
  use FinappWeb.ConnCase, async: true

  import Ecto.Query

  alias Finapp.Accounts.User
  alias Finapp.ML.TrainingExample

  @input_dim 100

  defp features, do: Enum.map(1..@input_dim, fn i -> i / 100.0 end)

  defp create_user(email \\ "training@example.com") do
    Repo.insert!(User.registration_changeset(%User{}, %{"email" => email, "password" => "password123"}))
  end

  defp authed(conn, user) do
    {:ok, token, _claims} = Finapp.Guardian.build_token(user)
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  defp post_training(conn, params) do
    post(conn, "/api/v1/ml/training-data", params)
  end

  defp valid_params(overrides \\ %{}) do
    Map.merge(
      %{
        "model_type" => "categorizer",
        "examples" => [
          %{"features" => features(), "label" => "cat-groceries"},
          %{"features" => features(), "label" => "cat-dining"}
        ]
      },
      overrides
    )
  end

  describe "POST /api/v1/ml/training-data" do
    test "returns 204 and inserts examples for valid batch", %{conn: conn} do
      user = create_user()

      resp = conn |> authed(user) |> post_training(valid_params())
      assert resp.status == 204

      count = Repo.aggregate(from(e in TrainingExample, where: e.model_type == "categorizer"), :count)
      assert count == 2
    end

    test "inserts anomaly model examples", %{conn: conn} do
      user = create_user("anomaly@example.com")

      params = valid_params(%{
        "model_type" => "anomaly",
        "examples" => [%{"features" => features(), "label" => "normal"}]
      })

      resp = conn |> authed(user) |> post_training(params)
      assert resp.status == 204

      count = Repo.aggregate(from(e in TrainingExample, where: e.model_type == "anomaly"), :count)
      assert count == 1
    end

    test "returns 401 when unauthenticated", %{conn: conn} do
      resp = post_training(conn, valid_params())
      assert resp.status == 401
    end

    test "returns 422 for invalid model_type", %{conn: conn} do
      user = create_user("bad_type@example.com")

      resp =
        conn
        |> authed(user)
        |> post_training(valid_params(%{"model_type" => "unknown"}))

      assert json_response(resp, 422)["error"] =~ "model_type"
    end

    test "returns 422 when features vector has wrong length", %{conn: conn} do
      user = create_user("bad_features@example.com")

      params = valid_params(%{
        "examples" => [%{"features" => [1.0, 2.0, 3.0], "label" => "cat-groceries"}]
      })

      assert json_response(conn |> authed(user) |> post_training(params), 422)["error"] =~
               "#{@input_dim} features"
    end

    test "returns 422 when label is empty", %{conn: conn} do
      user = create_user("bad_label@example.com")

      params = valid_params(%{
        "examples" => [%{"features" => features(), "label" => ""}]
      })

      assert json_response(conn |> authed(user) |> post_training(params), 422)["error"] =~
               "label"
    end

    test "returns 422 when examples list is empty", %{conn: conn} do
      user = create_user("empty@example.com")

      resp = conn |> authed(user) |> post_training(valid_params(%{"examples" => []}))
      assert json_response(resp, 422)["error"] =~ "empty"
    end

    test "examples are inserted with exported_at nil", %{conn: conn} do
      user = create_user("unexported@example.com")

      conn |> authed(user) |> post_training(valid_params())

      unexported =
        Repo.all(from e in TrainingExample, where: is_nil(e.exported_at))

      assert length(unexported) == 2
    end
  end
end
