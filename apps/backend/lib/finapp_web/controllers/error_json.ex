defmodule FinappWeb.ErrorJSON do
  def render("404.json", _assigns), do: %{error: "not_found"}
  def render("500.json", _assigns), do: %{error: "internal_server_error"}
  def render(template, _assigns), do: %{error: Phoenix.Controller.status_message_from_template(template)}
end
