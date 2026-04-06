defmodule Finapp.Sync.SimpleFinTest do
  use ExUnit.Case, async: true

  alias Finapp.Sync.{SimpleFin, SyncJob, Transaction}
  alias Finapp.Vault

  # A valid setup token is a base64-encoded claim URL.
  @claim_url "https://bridge.simplefin.org/simplefin/claim/testtoken123"
  @access_url "https://user:secret@bridge.simplefin.org/simplefin"

  defp setup_token, do: Base.encode64(@claim_url)

  defp make_job(access_url \\ @access_url, cursor \\ nil) do
    {:ok, encrypted} = Vault.encrypt(access_url)
    %SyncJob{encrypted_access_url_ref: encrypted, last_cursor: cursor}
  end

  defp stub(fun), do: Req.Test.stub(SimpleFin, fun)

  defp json_resp(conn, status \\ 200, body) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(status, Jason.encode!(body))
  end

  defp text_resp(conn, status \\ 200, body) do
    conn
    |> Plug.Conn.put_resp_content_type("text/plain")
    |> Plug.Conn.send_resp(status, body)
  end

  describe "claim_access_url/1" do
    test "exchanges token for encrypted access URL ref" do
      stub(fn conn -> text_resp(conn, @access_url) end)

      assert {:ok, encrypted_ref} = SimpleFin.claim_access_url(setup_token())
      assert is_binary(encrypted_ref)
      # The returned ref must decrypt back to the original access URL
      assert {:ok, @access_url} = Vault.decrypt(encrypted_ref)
    end

    test "returns error for invalid base64 token" do
      assert {:error, "Invalid setup token encoding"} =
               SimpleFin.claim_access_url("not-valid-base64!!!")
    end

    test "returns error when Bridge responds with non-200" do
      stub(fn conn -> text_resp(conn, 403, "Forbidden") end)

      assert {:error, "SimpleFIN returned 403"} = SimpleFin.claim_access_url(setup_token())
    end

    test "passes the decoded URL as the POST target" do
      stub(fn conn ->
        assert conn.request_path == "/simplefin/claim/testtoken123"
        text_resp(conn, @access_url)
      end)

      assert {:ok, _} = SimpleFin.claim_access_url(setup_token())
    end
  end

  describe "fetch_transactions/1" do
    test "returns parsed transactions from a single account" do
      job = make_job()

      stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{
              "id" => "acct_123",
              "currency" => "USD",
              "transactions" => [
                %{
                  "id" => "tx_1",
                  "amount" => "-42.50",
                  "description" => "Coffee Shop",
                  "posted" => "2026-04-01",
                  "transacted_at" => "2026-03-31",
                  "pending" => false
                },
                %{
                  "id" => "tx_2",
                  "amount" => "-12.00",
                  "description" => "Bus fare",
                  "posted" => "2026-04-02",
                  "transacted_at" => "2026-04-02",
                  "pending" => false
                }
              ]
            }
          ]
        })
      end)

      assert {:ok, %{transactions: txns, next_cursor: cursor}} =
               SimpleFin.fetch_transactions(job)

      assert length(txns) == 2

      [coffee, bus] = Enum.sort_by(txns, & &1.external_id)

      assert %Transaction{
               external_id: "tx_1",
               account_external_id: "acct_123",
               amount: -42.5,
               description: "Coffee Shop",
               posted_at: "2026-04-01",
               date: "2026-03-31",
               pending: false,
               currency: "USD"
             } = coffee

      assert %Transaction{external_id: "tx_2"} = bus

      # Cursor advances to the latest posted date
      assert cursor == "2026-04-02"
    end

    test "flattens transactions across multiple accounts" do
      job = make_job()

      stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{
              "id" => "acct_a",
              "currency" => "USD",
              "transactions" => [%{"id" => "tx_a", "amount" => "10.00", "posted" => "2026-04-01"}]
            },
            %{
              "id" => "acct_b",
              "currency" => "EUR",
              "transactions" => [%{"id" => "tx_b", "amount" => "20.00", "posted" => "2026-04-01"}]
            }
          ]
        })
      end)

      assert {:ok, %{transactions: txns}} = SimpleFin.fetch_transactions(job)
      assert length(txns) == 2
      account_ids = Enum.map(txns, & &1.account_external_id) |> Enum.sort()
      assert account_ids == ["acct_a", "acct_b"]
    end

    test "returns empty transactions and nil cursor for account with no transactions" do
      job = make_job()

      stub(fn conn ->
        json_resp(conn, %{"accounts" => [%{"id" => "acct_empty", "currency" => "USD", "transactions" => []}]})
      end)

      assert {:ok, %{transactions: [], next_cursor: nil}} = SimpleFin.fetch_transactions(job)
    end

    test "passes cursor as start_date query param" do
      job = make_job(@access_url, "2026-03-01")

      stub(fn conn ->
        params = URI.decode_query(conn.query_string)
        assert params["start_date"] == "2026-03-01"
        json_resp(conn, %{"accounts" => []})
      end)

      assert {:ok, _} = SimpleFin.fetch_transactions(job)
    end

    test "omits start_date when cursor is nil" do
      job = make_job(@access_url, nil)

      stub(fn conn ->
        assert conn.query_string == ""
        json_resp(conn, %{"accounts" => []})
      end)

      assert {:ok, _} = SimpleFin.fetch_transactions(job)
    end

    test "returns :connection_expired on 401" do
      job = make_job()
      stub(fn conn -> json_resp(conn, 401, %{}) end)

      assert {:error, :connection_expired} = SimpleFin.fetch_transactions(job)
    end

    test "returns :rate_limited on 429" do
      job = make_job()
      stub(fn conn -> json_resp(conn, 429, %{}) end)

      assert {:error, :rate_limited} = SimpleFin.fetch_transactions(job)
    end

    test "returns error tuple on unexpected status" do
      job = make_job()
      stub(fn conn -> json_resp(conn, 503, %{}) end)

      assert {:error, "SimpleFIN returned 503"} = SimpleFin.fetch_transactions(job)
    end

    test "handles pending transactions" do
      job = make_job()

      stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{
              "id" => "acct_1",
              "currency" => "USD",
              "transactions" => [
                %{"id" => "tx_pending", "amount" => "-5.00", "posted" => nil, "pending" => true}
              ]
            }
          ]
        })
      end)

      assert {:ok, %{transactions: [tx]}} = SimpleFin.fetch_transactions(job)
      assert tx.pending == true
    end

    test "defaults currency to USD when account omits it" do
      job = make_job()

      stub(fn conn ->
        json_resp(conn, %{
          "accounts" => [
            %{"id" => "acct_1", "transactions" => [%{"id" => "tx_1", "amount" => "1.00", "posted" => "2026-04-01"}]}
          ]
        })
      end)

      assert {:ok, %{transactions: [tx]}} = SimpleFin.fetch_transactions(job)
      assert tx.currency == "USD"
    end
  end
end
