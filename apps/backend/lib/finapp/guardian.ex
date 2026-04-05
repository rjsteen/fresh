defmodule Finapp.Guardian do
  use Guardian, otp_app: :finapp

  alias Finapp.Accounts.User
  alias Finapp.Repo

  def subject_for_token(%User{id: id}, _claims), do: {:ok, id}
  def subject_for_token(_, _), do: {:error, :unknown_resource}

  def resource_from_claims(%{"sub" => id}) do
    case Repo.get(User, id) do
      nil -> {:error, :resource_not_found}
      user -> {:ok, user}
    end
  end
  def resource_from_claims(_), do: {:error, :missing_sub}

  def build_token(%User{} = user, ttl \\ {24, :hours}) do
    encode_and_sign(user, %{}, ttl: ttl, token_type: "access")
  end

  def build_refresh_token(%User{} = user) do
    encode_and_sign(user, %{}, ttl: {30, :days}, token_type: "refresh")
  end
end
