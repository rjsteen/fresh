defmodule FinappWeb.ConnectionControllerTest do
  use FinappWeb.ConnCase, async: true

  alias Finapp.Accounts.User
  alias Finapp.Sync.{BankSyncWorker, SyncJob}

  @access_url "https://user:secret@bridge.simplefin.org/simplefin"

  defp create_user(attrs \\ %{}) do
    attrs = Map.merge(%{"email" => "test@example.com", "password" => "password123"}, attrs)
    Repo.insert!(User.registration_changeset(%User{}, attrs))
  end

  defp authed(conn, user) do
    {:ok, token, _claims} = Finapp.Guardian.build_token(user)
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  defp simplefin_stub(fun), do: Req.Test.stub(Finapp.Sync.SimpleFin, fun)
  defp gocardless_stub(fun), do: Req.Test.stub(Finapp.Sync.GoCardless, fun)

  defp json_resp(conn, status \\ 200, body) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(status, Jason.encode!(body))
  end

  defp text_resp(conn, body) do
    conn
    |> Plug.Conn.put_resp_content_type("text/plain")
    |> Plug.Conn.send_resp(200, body)
  end

  describe "POST /api/v1/connections/simplefin/claim" do
    test "creates a sync job and triggers a sync on success", %{conn: conn} do
      user = create_user()
      setup_token = Base.encode64("https://bridge.simplefin.org/simplefin/claim/abc123")
      simplefin_stub(fn conn -> text_resp(conn, @access_url) end)

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/connections/simplefin/claim", %{
          "setup_token" => setup_token,
          "account_token_ref" => "token-ref-xyz"
        })

      body = json_response(resp, 200)
      assert body["ok"] == true
      assert is_binary(body["sync_job_id"])

      job = Repo.get(SyncJob, body["sync_job_id"])
      assert job.user_id == user.id
      assert job.connection_type == "simplefin"
      assert job.account_token_ref == "token-ref-xyz"
      # Access URL must be encrypted, and must decrypt back to the original
      refute job.encrypted_access_url_ref == @access_url
      {:ok, decrypted} = Finapp.Vault.decrypt(job.encrypted_access_url_ref)
      assert decrypted == @access_url
      assert_enqueued(worker: BankSyncWorker, args: %{"sync_job_id" => job.id})
    end

    test "returns 422 when SimpleFIN bridge returns an error", %{conn: conn} do
      user = create_user()
      setup_token = Base.encode64("https://bridge.simplefin.org/simplefin/claim/bad")
      simplefin_stub(fn conn ->
        conn
        |> Plug.Conn.put_resp_content_type("text/plain")
        |> Plug.Conn.send_resp(403, "Forbidden")
      end)

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/connections/simplefin/claim", %{
          "setup_token" => setup_token,
          "account_token_ref" => "token-ref-fail"
        })

      assert resp.status == 422
      assert Repo.all(from j in SyncJob, where: j.user_id == ^user.id) == []
    end

    test "returns 422 for an invalid (non-base64) setup token", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/connections/simplefin/claim", %{
          "setup_token" => "!!not-base64!!",
          "account_token_ref" => "token-ref-bad"
        })

      assert resp.status == 422
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp =
        post(conn, "/api/v1/connections/simplefin/claim", %{
          "setup_token" => Base.encode64("https://example.com"),
          "account_token_ref" => "ref"
        })

      assert resp.status == 401
    end
  end

  describe "POST /api/v1/connections/gocardless/requisition" do
    test "returns link and requisition_id on success", %{conn: conn} do
      user = create_user()

      gocardless_stub(fn conn ->
        case conn.request_path do
          "/api/v2/token/new/" ->
            json_resp(conn, %{"access" => "test-gc-token", "refresh" => "refresh-tok"})

          "/api/v2/requisitions/" ->
            json_resp(conn, 201, %{
              "id" => "req-abc123",
              "link" => "https://bankauth.example.com/req-abc123",
              "status" => "CR"
            })
        end
      end)

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/connections/gocardless/requisition", %{
          "institution_id" => "MONZO_MBMONO",
          "account_token_ref" => "token-ref-eu",
          "redirect_url" => "https://app.fresh.app/connect/done"
        })

      body = json_response(resp, 200)
      assert body["link"] == "https://bankauth.example.com/req-abc123"
      assert body["requisition_id"] == "req-abc123"
    end

    test "returns 422 when token fetch fails", %{conn: conn} do
      user = create_user()

      gocardless_stub(fn conn ->
        json_resp(conn, 401, %{"detail" => "Invalid credentials"})
      end)

      resp =
        conn
        |> authed(user)
        |> post("/api/v1/connections/gocardless/requisition", %{
          "institution_id" => "MONZO_MBMONO",
          "account_token_ref" => "token-ref-eu",
          "redirect_url" => "https://app.fresh.app/connect/done"
        })

      assert resp.status == 422
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp =
        post(conn, "/api/v1/connections/gocardless/requisition", %{
          "institution_id" => "MONZO_MBMONO"
        })

      assert resp.status == 401
    end
  end

  describe "GET /api/v1/connections/gocardless/requisition/:id/status" do
    test "returns pending status with account_token_ref", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> get("/api/v1/connections/gocardless/requisition/req-abc123/status", %{
          "account_token_ref" => "my-token-ref"
        })

      body = json_response(resp, 200)
      assert body["status"] == "pending"
      assert body["account_token_ref"] == "my-token-ref"
    end

    test "returns 400 when account_token_ref is missing", %{conn: conn} do
      user = create_user()

      resp =
        conn
        |> authed(user)
        |> get("/api/v1/connections/gocardless/requisition/req-abc123/status")

      assert json_response(resp, 400) == %{"error" => "account_token_ref required"}
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      resp = get(conn, "/api/v1/connections/gocardless/requisition/req-abc/status")
      assert resp.status == 401
    end
  end

  describe "DELETE /api/v1/connections/:id" do
    test "deletes the sync job and returns ok", %{conn: conn} do
      user = create_user()
      {:ok, encrypted} = Finapp.Vault.encrypt(@access_url)

      job =
        Repo.insert!(%SyncJob{
          user_id: user.id,
          account_token_ref: "ref-to-delete",
          connection_type: "simplefin",
          encrypted_access_url_ref: encrypted
        })

      resp = conn |> authed(user) |> delete("/api/v1/connections/#{job.id}")

      assert json_response(resp, 200) == %{"ok" => true}
      assert Repo.get(SyncJob, job.id) == nil
    end

    test "returns 404 for another user's connection", %{conn: conn} do
      user1 = create_user(%{"email" => "u1@example.com"})
      user2 = create_user(%{"email" => "u2@example.com"})
      {:ok, encrypted} = Finapp.Vault.encrypt(@access_url)

      job =
        Repo.insert!(%SyncJob{
          user_id: user2.id,
          account_token_ref: "ref-theirs",
          connection_type: "simplefin",
          encrypted_access_url_ref: encrypted
        })

      resp = conn |> authed(user1) |> delete("/api/v1/connections/#{job.id}")

      assert json_response(resp, 404) == %{"error" => "not_found"}
      assert Repo.get(SyncJob, job.id) != nil
    end

    test "returns 401 for unauthenticated request", %{conn: conn} do
      assert delete(conn, "/api/v1/connections/some-id").status == 401
    end
  end
end
