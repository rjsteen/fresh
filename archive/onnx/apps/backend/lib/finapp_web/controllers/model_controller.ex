defmodule FinappWeb.ModelController do
  use Phoenix.Controller, formats: [:json]

  import Ecto.Query
  alias Finapp.ML.ModelDistributionWorker
  alias Finapp.Repo

  def notify(conn, %{"model_type" => model_type, "version" => version,
                     "cdn_path" => cdn_path, "checksum_sha256" => checksum}) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.transaction(fn ->
      # Retire the previous current version for this model type
      Repo.update_all(
        from(mv in "model_versions",
          where: mv.model_type == ^model_type and mv.is_current == true),
        set: [is_current: false]
      )

      # Upsert the new version — on conflict update all mutable fields
      Repo.insert_all(
        "model_versions",
        [%{
          id: Ecto.UUID.bingenerate(),
          model_type: model_type,
          version: version,
          cdn_path: cdn_path,
          checksum_sha256: checksum,
          is_current: true,
          deployed_at: now,
          inserted_at: now,
          updated_at: now
        }],
        on_conflict: [set: [cdn_path: cdn_path, checksum_sha256: checksum,
                            is_current: true, deployed_at: now, updated_at: now]],
        conflict_target: [:model_type, :version]
      )
    end)

    {:ok, _} =
      Oban.insert(ModelDistributionWorker.new(%{
        "model_type" => model_type,
        "version" => version,
        "cdn_path" => cdn_path,
        "checksum_sha256" => checksum
      }))

    json(conn, %{version: version})
  end

  def current_versions(conn, _params) do
    cdn_base = Application.get_env(:finapp, :cdn_base_url, "")

    rows =
      Repo.all(
        from mv in "model_versions",
          where: mv.is_current == true,
          select: %{
            model_type: mv.model_type,
            version: mv.version,
            cdn_path: mv.cdn_path,
            checksum: mv.checksum_sha256
          }
      )

    versions =
      Enum.map(rows, fn row ->
        %{model_type: row.model_type, version: row.version,
          cdn_url: "#{cdn_base}/#{row.cdn_path}", checksum: row.checksum}
      end)

    json(conn, %{models: versions})
  end
end
