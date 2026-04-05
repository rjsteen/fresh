defmodule FinappWeb.ModelController do
  use Phoenix.Controller, formats: [:json]

  import Ecto.Query
  alias Finapp.Repo

  def current_versions(conn, _params) do
    versions =
      Repo.all(
        from mv in "model_versions",
          where: mv.is_current == true,
          select: %{
            model_type: mv.model_type,
            version: mv.version,
            cdn_path: mv.cdn_path,
            checksum_sha256: mv.checksum_sha256
          }
      )

    json(conn, %{models: versions})
  end
end
