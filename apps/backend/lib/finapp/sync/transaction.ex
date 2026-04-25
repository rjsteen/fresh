defmodule Finapp.Sync.Transaction do
  @moduledoc "Normalized transaction returned by bank adapter fetch_transactions/1."

  @derive Jason.Encoder
  @enforce_keys [:external_id, :account_external_id, :amount, :currency]
  defstruct [
    :external_id,
    :account_external_id,
    :amount,
    :description,
    :merchant_name,
    :date,
    :posted_at,
    :currency,
    pending: false
  ]
end
