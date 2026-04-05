defmodule Finapp.Sync.SimpleFin do
  @moduledoc """
  SimpleFIN Bridge client for US bank connections.
  https://www.simplefin.org/protocol.html

  SimpleFIN uses a two-step flow:
  1. User visits SimpleFIN Bridge, generates an "access URL"
  2. App exchanges the one-time setup token for the permanent access URL
  3. App polls the access URL for transactions

  We store only an opaque encrypted reference to the access URL — never the URL itself
  in plaintext in Postgres.
  """

  alias Finapp.Sync.SyncJob
  alias Finapp.Vault

  @doc "Exchange a one-time setup token for a permanent access URL"
  def claim_access_url(setup_token) do
    # Setup tokens are base64-encoded URLs like https://bridge.simplefin.org/simplefin/claim/<token>
    with {:ok, claim_url} <- decode_setup_token(setup_token),
         {:ok, resp} <- Req.post(claim_url, body: "") do
      case resp.status do
        200 -> {:ok, resp.body}
        _ -> {:error, "Claim failed: #{resp.status}"}
      end
    end
  end

  @doc "Fetch transactions for a sync job. Returns raw transaction data."
  def fetch_transactions(%SyncJob{} = job) do
    with {:ok, access_url} <- decrypt_access_url(job.encrypted_access_url_ref),
         {:ok, resp} <- do_fetch(access_url, job.last_cursor) do
      parse_response(resp)
    end
  end

  defp do_fetch(access_url, cursor) do
    params = if cursor, do: [start_date: cursor], else: []

    case Req.get(access_url, params: params, receive_timeout: 30_000) do
      {:ok, %{status: 200} = resp} -> {:ok, resp}
      {:ok, %{status: 429}} -> {:error, :rate_limited}
      {:ok, %{status: 401}} -> {:error, :connection_expired}
      {:ok, %{status: status}} -> {:error, "SimpleFIN returned #{status}"}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_response(%{body: body}) do
    # SimpleFIN response shape:
    # { "accounts": [{ "id": "...", "transactions": [...] }] }
    accounts = get_in(body, ["accounts"]) || []

    transactions =
      Enum.flat_map(accounts, fn account ->
        (account["transactions"] || [])
        |> Enum.map(&normalize_transaction(&1, account))
      end)

    # Use the latest transaction date as the next cursor
    next_cursor =
      transactions
      |> Enum.map(& &1.posted_at)
      |> Enum.reject(&is_nil/1)
      |> Enum.max(fn -> nil end)

    {:ok, %{transactions: transactions, next_cursor: next_cursor}}
  end

  defp normalize_transaction(tx, account) do
    %{
      external_id: tx["id"],
      account_external_id: account["id"],
      amount: parse_amount(tx["amount"]),
      description: tx["description"] || "",
      merchant_name: nil,                       # SimpleFIN doesn't provide merchant enrichment
      date: tx["transacted_at"] || tx["posted"],
      posted_at: tx["posted"],
      pending: tx["pending"] == true,
      currency: account["currency"] || "USD"
    }
  end

  defp parse_amount(nil), do: 0.0
  defp parse_amount(amount) when is_float(amount), do: amount
  defp parse_amount(amount) when is_integer(amount), do: amount * 1.0
  defp parse_amount(amount) when is_binary(amount) do
    case Float.parse(amount) do
      {f, _} -> f
      :error -> 0.0
    end
  end

  defp decode_setup_token(token) do
    case Base.decode64(token) do
      {:ok, url} -> {:ok, url}
      :error -> {:error, "Invalid setup token encoding"}
    end
  end

  defp decrypt_access_url(encrypted_ref) do
    Vault.decrypt(encrypted_ref)
  end
end
