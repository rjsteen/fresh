defmodule Finapp.Sync.GoCardless do
  @moduledoc """
  GoCardless Bank Account Data (formerly Nordigen) client for EU bank connections.
  https://developer.gocardless.com/bank-account-data/overview

  Flow:
  1. Create a requisition (end-user authorization link)
  2. User completes bank auth on their bank's website
  3. Poll transactions using the account ID from the requisition

  We store only the encrypted account ID ref — no access tokens in plaintext.
  """

  alias Finapp.Sync.SyncJob

  @base_url Application.compile_env(
              :finapp,
              [:gocardless, :base_url],
              "https://bankaccountdata.gocardless.com"
            )

  @doc "Create a requisition and return the authorization link for the user"
  def create_requisition(institution_id, redirect_url, reference) do
    with {:ok, token} <- get_access_token(),
         {:ok, resp} <- req_post(
           "#{@base_url}/api/v2/requisitions/",
           headers: auth_headers(token),
           json: %{
             redirect: redirect_url,
             institution_id: institution_id,
             reference: reference,
             agreement: nil,
             user_language: "EN"
           }
         ) do
      case resp.status do
        201 ->
          {:ok, %{
            id: resp.body["id"],
            link: resp.body["link"],
            status: resp.body["status"]
          }}
        _ ->
          {:error, "Requisition creation failed: #{resp.status} #{inspect(resp.body)}"}
      end
    end
  end

  @doc "Fetch transactions for a completed requisition"
  def fetch_transactions(%SyncJob{} = job) do
    with {:ok, account_id} <- decrypt_account_id(job.encrypted_access_url_ref),
         {:ok, token} <- get_access_token(),
         {:ok, resp} <- do_fetch(account_id, token, job.last_cursor) do
      parse_response(resp, account_id)
    end
  end

  defp do_fetch(account_id, token, cursor) do
    params = if cursor, do: [date_from: cursor], else: []

    case req_get(
           "#{@base_url}/api/v2/accounts/#{account_id}/transactions/",
           headers: auth_headers(token),
           params: params,
           receive_timeout: 30_000
         ) do
      {:ok, %{status: 200} = resp} -> {:ok, resp}
      {:ok, %{status: 429}} -> {:error, :rate_limited}
      {:ok, %{status: 401}} -> {:error, :connection_expired}
      {:ok, %{status: 403}} -> {:error, :connection_expired}
      {:ok, %{status: status}} -> {:error, "GoCardless returned #{status}"}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_response(%{body: body}, account_id) do
    booked = get_in(body, ["transactions", "booked"]) || []
    pending = get_in(body, ["transactions", "pending"]) || []

    transactions =
      (Enum.map(booked, &normalize_transaction(&1, account_id, false)) ++
         Enum.map(pending, &normalize_transaction(&1, account_id, true)))

    next_cursor =
      booked
      |> Enum.map(&(&1["bookingDate"] || &1["valueDate"]))
      |> Enum.reject(&is_nil/1)
      |> Enum.max(fn -> nil end)

    {:ok, %{transactions: transactions, next_cursor: next_cursor}}
  end

  defp normalize_transaction(tx, account_id, pending?) do
    amount = parse_amount(tx["transactionAmount"])
    %{
      external_id: tx["transactionId"] || tx["internalTransactionId"],
      account_external_id: account_id,
      amount: amount,
      description:
        tx["remittanceInformationUnstructured"] ||
          tx["remittanceInformationStructured"] ||
          tx["additionalInformation"] || "",
      merchant_name: tx["creditorName"] || tx["debtorName"],
      date: tx["bookingDate"] || tx["valueDate"],
      posted_at: tx["bookingDate"],
      pending: pending?,
      currency: get_in(tx, ["transactionAmount", "currency"]) || "EUR"
    }
  end

  defp parse_amount(%{"amount" => amount, "currency" => _}) when is_binary(amount) do
    case Float.parse(amount) do
      {f, _} -> f
      :error -> 0.0
    end
  end
  defp parse_amount(_), do: 0.0

  defp auth_headers(token), do: [{"Authorization", "Bearer #{token}"}]

  defp get_access_token do
    secret_id = Application.get_env(:finapp, :gocardless)[:secret_id] ||
      System.get_env("GOCARDLESS_SECRET_ID")
    secret_key = Application.get_env(:finapp, :gocardless)[:secret_key] ||
      System.get_env("GOCARDLESS_SECRET_KEY")

    case req_post(
           "#{@base_url}/api/v2/token/new/",
           json: %{secret_id: secret_id, secret_key: secret_key}
         ) do
      {:ok, %{status: 200, body: %{"access" => token}}} -> {:ok, token}
      {:ok, %{status: status}} -> {:error, "Token fetch failed: #{status}"}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decrypt_account_id(encrypted_ref) do
    Finapp.Vault.decrypt(encrypted_ref)
  end

  defp req_plug, do: Application.get_env(:finapp, __MODULE__, [])[:req_plug]

  defp req_post(url, opts) do
    case req_plug() do
      nil -> Req.post(url, opts)
      plug -> Req.post(url, Keyword.put(opts, :plug, plug))
    end
  end

  defp req_get(url, opts) do
    case req_plug() do
      nil -> Req.get(url, opts)
      plug -> Req.get(url, Keyword.put(opts, :plug, plug))
    end
  end
end
