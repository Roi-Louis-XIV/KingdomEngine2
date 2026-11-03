import {
  ArrowRight,
  Building2,
  CircleCheck,
  Clock3,
  Plus,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../context";
import { useResource } from "../useResource";
import type { Entity, Overview } from "../types";
import { date } from "../model";
import { Empty, ErrorNotice, Loading, Status } from "../components/ui";

export function Dashboard() {
  const { api, world, href, writable } = useWorkspace();
  const content = useResource<Entity[]>(api, "/api/content");
  const summary = useResource<Overview>(api, "/api/admin/overview");
  if (content.loading) return <Loading />;
  if (content.error)
    return <ErrorNotice error={content.error} retry={content.reload} />;
  const rows = content.data ?? [];
  const buildings = rows.filter((r) => r.entity_type === "building");
  const drafts = rows.filter((r) => r.status === "draft");
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VUE D’ENSEMBLE</span>
          <h1>Tableau de bord</h1>
          <p>
            Un regard sur votre monde. Une porte vers vos prochaines créations.
          </p>
        </div>
        <Link className="button" to={href("/studio")}>
          Ouvrir le Studio <ArrowRight size={16} />
        </Link>
      </div>
      <section className="world-banner">
        <div className="contour" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="banner-content">
          <span className="eyebrow">
            <span className="signal" /> MONDE SÉLECTIONNÉ
          </span>
          <h2>{world.name}</h2>
          <p>
            {world.guild_id
              ? "Relié à un serveur Discord"
              : "Connexion Discord à configurer"}{" "}
            · {buildings.length} bâtiment{buildings.length > 1 ? "s" : ""} à
            faire vivre
          </p>
          <Link to={href("/monde")}>
            Explorer le monde <ArrowRight size={16} />
          </Link>
        </div>
        <div className="world-orbit" aria-hidden="true">
          <span>◇</span>
        </div>
      </section>
      <div className="metrics">
        <article>
          <Building2 size={19} />
          <strong>{buildings.length}</strong>
          <span>Bâtiments dans le Studio</span>
          <small>
            {buildings.filter((b) => b.status === "published").length} révisions
            actives sans brouillon
          </small>
        </article>
        <article>
          <Users size={19} />
          <strong>{summary.data?.metrics.players ?? "—"}</strong>
          <span>Joueurs enregistrés</span>
          <small>Données du moteur</small>
        </article>
        <article>
          <Clock3 size={19} />
          <strong>{drafts.length}</strong>
          <span>Brouillons à poursuivre</span>
          <small>Tous les contenus du monde</small>
        </article>
      </div>
      <div className="dashboard-grid">
        <div>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Votre atelier</h2>
                <p>Retrouvez vos bâtiments et poursuivez leur création.</p>
              </div>
              <Link to={href("/studio")}>
                Tout voir <ArrowRight size={15} />
              </Link>
            </div>
            {buildings.length ? (
              <div className="work-list">
                {buildings.slice(0, 4).map((b) => (
                  <Link
                    key={b.entity_key}
                    to={href(`/studio/${b.entity_key}`)}
                    className="work-row"
                  >
                    <span className="entity-symbol">
                      {b.payload.emoji || "◇"}
                    </span>
                    <div>
                      <strong>{b.payload.name}</strong>
                      <small>
                        {b.payload.category || "Bâtiment"} · Révision{" "}
                        {b.version}
                      </small>
                    </div>
                    <Status status={b.status} />
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="Votre premier bâtiment">
                <p>
                  Commencez depuis un lieu vide, puis composez son identité.
                </p>
                {writable && (
                  <Link className="button primary" to={href("/studio/new")}>
                    <Plus size={16} />
                    Créer un bâtiment
                  </Link>
                )}
              </Empty>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Activité récente</h2>
                <p>Les dernières évolutions de ce monde.</p>
              </div>
            </div>
            {summary.error ? (
              <ErrorNotice error={summary.error} retry={summary.reload} />
            ) : summary.loading ? (
              <Loading label="Lecture de l’activité…" />
            ) : (
              <div className="timeline">
                {(summary.data?.changes ?? [])
                  .slice()
                  .reverse()
                  .slice(0, 6)
                  .map((change) => (
                    <div key={change.id}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>
                          {change.kind === "content.published"
                            ? "Publication de contenu"
                            : change.kind === "content.draft.saved"
                              ? "Brouillon enregistré"
                              : "Évolution du monde"}
                        </strong>
                        <p>
                          {rows.find(
                            (r) =>
                              r.entity_key === change.aggregate_key &&
                              r.entity_type === change.aggregate_type,
                          )?.payload.name ?? change.aggregate_key}
                        </p>
                        <time dateTime={change.created_at}>
                          {date(change.created_at)} · Paris
                        </time>
                      </div>
                    </div>
                  ))}
                {!summary.data?.changes.length && (
                  <p className="muted">
                    Aucune activité enregistrée pour le moment.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
        <aside>
          <section className="panel health-panel">
            <div className="section-heading">
              <h2>État du monde</h2>
              <CircleCheck size={18} />
            </div>
            {summary.error ? (
              <ErrorNotice error={summary.error} retry={summary.reload} />
            ) : summary.loading ? (
              <Loading label="Lecture de l’état…" />
            ) : (
              <>
                {summary.data?.services.map((service) => (
                  <div className="health-row" key={service.key}>
                    <span>{service.name}</span>
                    <span
                      className={service.running ? "health-ready" : "muted"}
                    >
                      <i />
                      {service.running ? "Disponible" : "Hors ligne"}
                    </span>
                  </div>
                ))}
                <p className="help">
                  L’état du moteur et de l’audio est indépendant de votre
                  session Studio.
                </p>
                <small>Observé le {date(summary.data?.generated_at)}</small>
              </>
            )}
          </section>
          <section className="panel next-step">
            <span className="eyebrow">CONTINUER LA CRÉATION</span>
            <h2>Chaque lieu est un point de départ.</h2>
            <p>
              Une identité, des mécaniques, des interactions. Construisez votre
              monde à votre rythme.
            </p>
            <Link to={href("/studio")}>
              Parcourir les bâtiments <ArrowRight size={16} />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
