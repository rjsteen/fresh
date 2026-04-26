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

  alias Finapp.Sync.{SyncJob, Transaction}
  alias Finapp.Vault

  @doc """
  Exchange a one-time setup token for a permanent access URL.

  Returns `{:ok, encrypted_ref}` where `encrypted_ref` is ready to be stored
  in `sync_jobs.encrypted_access_url_ref`. The plaintext URL never leaves this function.
  """
  def claim_access_url(setup_token) do
    with {:ok, claim_url} <- decode_setup_token(setup_token),
         {:ok, resp} <- do_req_post(claim_url, body: "") do
      Vault.encrypt(String.trim(resp.body))
    end
  end

  @doc "Fetch transactions for a sync job. Returns parsed transactions and next cursor."
  def fetch_transactions(%SyncJob{} = job) do
    with {:ok, access_url} <- Vault.decrypt(job.encrypted_access_url_ref),
         {:ok, resp} <- do_req_get(access_url <> "/accounts", params: cursor_params(job.last_cursor), receive_timeout: 30_000) do
      parse_response(resp)
    end
  end

  # --- Private ---

  defp cursor_params(nil), do: []
  defp cursor_params(cursor), do: [start_date: cursor]

  defp do_req_get(url, opts) do
    {clean_url, opts} = extract_auth(url, base_opts(opts))
    case req_plug() do
      nil -> Req.get(clean_url, opts)
      plug -> Req.get(clean_url, Keyword.put(opts, :plug, plug))
    end
    |> handle_http_response()
  end

  defp do_req_post(url, opts) do
    {clean_url, opts} = extract_auth(url, base_opts(opts))
    case req_plug() do
      nil -> Req.post(clean_url, opts)
      plug -> Req.post(clean_url, Keyword.put(opts, :plug, plug))
    end
    |> handle_http_response()
  end

  # Req doesn't auto-extract credentials from user:pass@host URLs.
  # Parse them out and pass via the :auth option instead.
  defp extract_auth(url, opts) do
    uri = URI.parse(url)

    case uri.userinfo do
      nil ->
        {url, opts}

      userinfo ->
        [user | rest] = String.split(userinfo, ":", parts: 2)
        pass = List.first(rest, "")
        clean_url = URI.to_string(%{uri | userinfo: nil})
        {clean_url, Keyword.put(opts, :auth, {:basic, "#{user}:#{pass}"})}
    end
  end

  # Disable Req's built-in retry so callers control retry behaviour (e.g. Oban snooze).
  defp base_opts(opts), do: Keyword.put_new(opts, :retry, false)

  defp handle_http_response({:ok, %{status: 200} = resp}), do: {:ok, resp}
  defp handle_http_response({:ok, %{status: 401}}), do: {:error, :connection_expired}
  defp handle_http_response({:ok, %{status: 429}}), do: {:error, :rate_limited}
  defp handle_http_response({:ok, %{status: status}}), do: {:error, "SimpleFIN returned #{status}"}
  defp handle_http_response({:error, reason}), do: {:error, reason}

  defp parse_response(%{body: body}) when is_map(body) do
    accounts = body["accounts"] || []

    transactions =
      Enum.flat_map(accounts, fn account ->
        (account["transactions"] || [])
        |> Enum.map(&normalize_transaction(&1, account))
      end)

    next_cursor =
      transactions
      |> Enum.map(& &1.posted_at)
      |> Enum.reject(&is_nil/1)
      |> Enum.max(fn -> nil end)

    {:ok, %{transactions: transactions, next_cursor: next_cursor}}
  end

  defp parse_response(%{body: body}) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, decoded} -> parse_response(%{body: decoded})
      {:error, _} -> {:error, "Invalid JSON from SimpleFIN"}
    end
  end

  defp normalize_transaction(tx, account) do
    %Transaction{
      external_id: tx["id"],
      account_external_id: account["id"],
      amount: parse_amount(tx["amount"]),
      description: tx["description"] || "",
      merchant_name: nil,
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

  defp req_plug, do: Application.get_env(:finapp, __MODULE__, [])[:req_plug]
end
