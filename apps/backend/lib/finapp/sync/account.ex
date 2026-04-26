defmodule Finapp.Sync.Account do
  @moduledoc "Normalized account metadata returned by bank adapter fetch_transactions/1."

  @derive Jason.Encoder
  @enforce_keys [:external_id, :name, :currency]
  defstruct [
    :external_id,
    :name,
    :institution,
    :currency,
    :balance,
    :available_balance,
    :type
  ]
end
