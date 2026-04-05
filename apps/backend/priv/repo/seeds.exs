# Seeds run after migrations. No financial data seeded — the device DB owns that.
# Add dev user for local testing.

alias Finapp.Repo
alias Finapp.Accounts.User

if Mix.env() == :dev do
  case Repo.get_by(User, email: "dev@example.com") do
    nil ->
      %User{}
      |> User.registration_changeset(%{
        "email" => "dev@example.com",
        "password" => "devpassword123",
        "region" => "us"
      })
      |> Repo.insert!()
      IO.puts("Seeded dev user: dev@example.com / devpassword123")

    _ ->
      IO.puts("Dev user already exists, skipping")
  end
end
