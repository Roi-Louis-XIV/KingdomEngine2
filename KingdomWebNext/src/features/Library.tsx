import { useEffect, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, Building2, Plus, SlidersHorizontal } from "lucide-react";
import { useWorkspace } from "../context";
import { useResource } from "../useResource";
import type { Entity } from "../types";
import { filterEntities } from "../model";
import { Empty, ErrorNotice, Loading, Search, Status } from "../components/ui";

export function Library() {
  const { api, href, writable } = useWorkspace();
  const { data, loading, error, reload } = useResource<Entity[]>(
    api,
    "/api/content?entity_type=building",
  );
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const title = useRef<HTMLHeadingElement>(null);
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const filtered = filterEntities(data ?? [], query, status).sort((a, b) =>
    a.payload.name.localeCompare(b.payload.name, "fr"),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  };
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STUDIO / BIBLIOTHÈQUE</span>
          <h1 tabIndex={-1} ref={title}>
            Bâtiments
          </h1>
          <p>
            Des lieux singuliers, des mécaniques partagées. Votre monde se
            compose ici.
          </p>
        </div>
        {writable && (
          <Link
            className="button primary"
            to={href("/studio/new")}
            state={{ returnTo: location.pathname + location.search }}
          >
            <Plus size={17} />
            Créer un bâtiment
          </Link>
        )}
      </div>
      <div className="library-summary">
        <Building2 size={21} />
        <div>
          <strong>Bibliothèque du monde</strong>
          <span>
            {data?.length ?? "—"} bâtiments ·{" "}
            {data?.filter((b) => b.status === "draft").length ?? "—"} brouillons
          </span>
        </div>
        <span className="badge">Contenus réels</span>
      </div>
      <div className="toolbar">
        <Search value={query} onChange={(v) => update("q", v)} />
        <label className="filter">
          <SlidersHorizontal size={16} />
          <span className="sr-only">État des bâtiments</span>
          <select
            value={status}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Tous les états</option>
            <option value="draft">Brouillons</option>
            <option value="published">Publiés</option>
          </select>
        </label>
        <span className="result-count" role="status">
          {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
        </span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice error={error} retry={reload} />
      ) : !filtered.length ? (
        <Empty
          title={
            query || status
              ? "Aucun bâtiment ne correspond"
              : "Un monde à construire"
          }
        >
          <p>
            {query || status
              ? "Essayez un autre nom ou effacez les filtres."
              : "Créez un bâtiment vide. Aucun modèle ni univers ne vous est imposé."}
          </p>
          {query || status ? (
            <button
              className="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                ["q", "status", "page"].forEach((k) => next.delete(k));
                setParams(next);
              }}
            >
              Effacer les filtres
            </button>
          ) : (
            writable && (
              <Link className="button primary" to={href("/studio/new")}>
                Créer un bâtiment
              </Link>
            )
          )}
        </Empty>
      ) : (
        <>
          <div className="building-grid">
            {filtered.slice((page - 1) * 12, page * 12).map((entity) => (
              <article className="building-card" key={entity.entity_key}>
                <div className="building-card-top">
                  <span className="building-emblem">
                    {entity.payload.emoji || "◇"}
                  </span>
                  <Status status={entity.status} />
                </div>
                <span className="eyebrow">
                  {entity.payload.category || "BÂTIMENT"}
                </span>
                <h2>{entity.payload.name}</h2>
                <p>
                  {entity.payload.description || "Ce lieu attend son histoire."}
                </p>
                <div className="building-meta">
                  <span>
                    {Object.keys(entity.payload.modules ?? {}).length} modules
                  </span>
                  <span>
                    {entity.payload.interface?.pages?.length ?? 0} pages
                    configurées
                  </span>
                </div>
                <Link
                  className="card-open"
                  to={href(`/studio/${entity.entity_key}`)}
                  state={{ returnTo: location.pathname + location.search }}
                >
                  Ouvrir le bâtiment <ArrowRight size={17} />
                </Link>
              </article>
            ))}
          </div>
          <nav className="pagination" aria-label="Pages de bâtiments">
            <button
              className="button"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("page", String(page - 1));
                setParams(next);
              }}
            >
              Précédent
            </button>
            <span>
              Page {page} sur {pages}
            </span>
            <button
              className="button"
              disabled={page >= pages}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("page", String(page + 1));
                setParams(next);
              }}
            >
              Suivant
            </button>
          </nav>
        </>
      )}
    </>
  );
}
