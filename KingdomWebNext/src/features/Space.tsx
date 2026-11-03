import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useWorkspace } from "../context";
import { useResource } from "../useResource";
import { labels } from "../model";
import type { Entity } from "../types";
import { Empty, ErrorNotice, Loading, Status } from "../components/ui";
import { Dashboard } from "./Dashboard";

const spaces: Record<
  string,
  { title: string; description: string; types: string[] }
> = {
  monde: {
    title: "Monde",
    description:
      "Les lieux, l’environnement et les connexions qui donnent corps à votre univers.",
    types: ["location", "environment", "server_settings"],
  },
  scenarios: {
    title: "Scénarios",
    description: "Les quêtes et événements qui rythment la vie du monde.",
    types: ["quest", "event"],
  },
  mediatheque: {
    title: "Médiathèque",
    description:
      "Les sons, ambiances, personnages vocaux et workers de ce monde.",
    types: [
      "audio",
      "audio_group",
      "audio_story",
      "voice_profile",
      "voice_presence",
      "bot",
    ],
  },
};
export function Space({ kind }: { kind: string }) {
  if (kind === "supervision")
    return (
      <>
        <div className="info-banner">
          Supervision : synthèse en lecture seule. Les interventions détaillées
          restent dans KingdomWeb classique.
        </div>
        <Dashboard />
      </>
    );
  if (kind === "missing")
    return (
      <Empty title="Cet espace n’existe pas">
        <Link className="button" to="/">
          Revenir au tableau de bord
        </Link>
      </Empty>
    );
  return <CatalogSpace kind={kind} />;
}
function CatalogSpace({ kind }: { kind: string }) {
  const { api, world } = useWorkspace();
  const { data, error, loading, reload } = useResource<Entity[]>(
    api,
    "/api/content",
  );
  const space = spaces[kind];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{world.name}</span>
          <h1>{space.title}</h1>
          <p>{space.description}</p>
        </div>
        <a className="button" href="/">
          Ouvrir l’éditeur classique <ArrowRight size={16} />
        </a>
      </div>
      <div className="info-banner">
        Vos données sont consultables ici. Les éditeurs spécialisés V3 seront
        ajoutés dans les prochaines tranches ; les fonctions existantes restent
        disponibles dans KingdomWeb classique.
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice error={error} retry={reload} />
      ) : (
        <div className="space-catalog">
          {space.types.map((type) => {
            const rows = (data ?? []).filter((r) => r.entity_type === type);
            return (
              <section className="panel" key={type}>
                <div className="section-heading">
                  <h2>{labels[type]}</h2>
                  <span className="badge">{rows.length}</span>
                </div>
                {rows.length ? (
                  <div className="entity-scroll">
                    {rows.map((r) => (
                      <details className="entity-detail" key={r.entity_key}>
                        <summary>
                          <span>
                            {r.payload.emoji || "◇"} {r.payload.name}
                          </span>
                          <Status status={r.status} />
                        </summary>
                        <p>{r.payload.description || "Aucune description."}</p>
                        <p className="muted">
                          Révision {r.version} · {r.entity_key}
                        </p>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    Aucun contenu de ce type dans ce monde.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
