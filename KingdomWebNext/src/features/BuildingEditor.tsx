import { useEffect, useRef, useState } from "react";
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  GitBranch,
  LayoutTemplate,
  Layers,
  Save,
  Send,
} from "lucide-react";
import { ApiError } from "../api";
import { useWorkspace } from "../context";
import { useResource } from "../useResource";
import type { BuildingPayload, Entity, Overview, SyncStatus } from "../types";
import {
  date,
  editIdentity,
  moduleLabels,
  newBuilding,
  buildingSyncMessage,
} from "../model";
import { Dialog, Empty, ErrorNotice, Loading, Status } from "../components/ui";

const tabs = [
  ["general", "Vue générale", LayoutTemplate],
  ["modules", "Fonctionnalités", Layers],
  ["interfaces", "Interfaces Discord", LayoutTemplate],
  ["data", "Activité & données", Database],
  ["relations", "Relations", GitBranch],
] as const;
export function BuildingEditor() {
  const { key = "" } = useParams();
  if (key === "new")
    return (
      <Editor
        initial={{
          entity_type: "building",
          entity_key: `building_${crypto.randomUUID().replaceAll("-", "")}`,
          version: 0,
          status: "draft",
          payload: newBuilding(),
        }}
      />
    );
  return <ExistingEditor entityKey={key} />;
}
function ExistingEditor({ entityKey }: { entityKey: string }) {
  const { api } = useWorkspace();
  const resource = useResource<Entity>(
    api,
    `/api/content/building/${encodeURIComponent(entityKey)}`,
  );
  if (resource.loading) return <Loading label="Ouverture du bâtiment…" />;
  if (resource.error)
    return <ErrorNotice error={resource.error} retry={resource.reload} />;
  return (
    <Editor
      key={`${entityKey}-${resource.data!.version}`}
      initial={resource.data!}
    />
  );
}
function Editor({ initial }: { initial: Entity }) {
  const { api, world, href, writable } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [record, setRecord] = useState(initial);
  const [payload, setPayload] = useState<BuildingPayload>(initial.payload);
  const [advanced, setAdvanced] = useState(false);
  const [tab, setTab] = useState("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [publish, setPublish] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [sync, setSync] = useState<SyncStatus>();
  const [syncError, setSyncError] = useState<Error>();
  const [syncBusy, setSyncBusy] = useState(false);
  const name = useRef<HTMLInputElement>(null);
  const allowNavigation = useRef(false);
  const dirty = JSON.stringify(payload) !== JSON.stringify(record.payload);
  const block = useBlocker(() => !allowNavigation.current && (dirty || busy));
  const references = useResource<Entity[]>(api, "/api/content");
  const returnTo =
    typeof location.state?.returnTo === "string"
      ? location.state.returnTo
      : href("/studio");
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    document.title = `${payload.name || "Nouveau bâtiment"} · ${world.name}`;
  }, [payload.name, world.name]);
  const patch = (change: Partial<BuildingPayload>) => {
    setPayload((current) => editIdentity(current, change));
    setNotice("");
  };
  async function save() {
    if (busy || !writable) return;
    if (!payload.name.trim()) {
      setFieldError("Donnez un nom à ce bâtiment pour l’enregistrer.");
      setTab("general");
      name.current?.focus();
      return;
    }
    setFieldError("");
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const saved = await api.saveBuilding(
        record.entity_key,
        { ...payload, name: payload.name.trim() },
        record.version,
      );
      setRecord(saved);
      setPayload(saved.payload);
      setNotice("Brouillon enregistré. La version active reste inchangée.");
      if (!record.version) {
        allowNavigation.current = true;
        navigate(href(`/studio/${saved.entity_key}`), {
          replace: true,
          state: { returnTo },
        });
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  async function checkSync() {
    setSyncBusy(true);
    setSyncError(undefined);
    try {
      setSync(await api.get<SyncStatus>("/api/admin/discord/provision/status"));
    } catch (e) {
      setSyncError(e as Error);
    } finally {
      setSyncBusy(false);
    }
  }
  async function publishSaved() {
    if (busy || dirty || !writable || record.status !== "draft") return;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const saved = await api.publish(record);
      setRecord(saved);
      setPayload(saved.payload);
      setPublish(false);
      setNotice(
        `Révision ${saved.version} publiée dans le moteur. La synchronisation Discord a été demandée.`,
      );
      await checkSync();
    } catch (e) {
      setPublish(false);
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  const modules = Object.entries(payload.modules ?? {});
  const pages = payload.interface?.pages ?? [];
  return (
    <>
      <Link className="back-link" to={returnTo}>
        <ArrowLeft size={16} />
        Bibliothèque des bâtiments
      </Link>
      <div className="editor-heading">
        <span className="editor-emblem">{payload.emoji || "◇"}</span>
        <div>
          <span className="eyebrow">STUDIO / ESPACE BÂTIMENT</span>
          <h1>{payload.name || "Nouveau bâtiment"}</h1>
          <div className="editor-meta">
            <Status status={record.version ? record.status : "Nouveau"} />
            <span>
              {record.version
                ? `Révision ${record.version}`
                : "Configuration vide"}
            </span>
            <span>{world.name}</span>
          </div>
        </div>
        <div className="mode-switch" role="group" aria-label="Mode d’édition">
          <button aria-pressed={!advanced} onClick={() => setAdvanced(false)}>
            Guidé
          </button>
          <button aria-pressed={advanced} onClick={() => setAdvanced(true)}>
            Avancé
          </button>
        </div>
      </div>
      <nav className="editor-tabs" aria-label="Sections du bâtiment">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      {!writable && (
        <div className="info-banner">
          Vous disposez d’un accès en lecture seule à ce monde.
        </div>
      )}
      <div className="editor-body">
        {error && (
          <>
            <ErrorNotice error={error} retry={() => setError(undefined)} />
            {error instanceof ApiError && error.status === 409 && (
              <div className="conflict-recovery">
                <p>
                  Une autre révision existe. Votre saisie est conservée.
                  Rechargez la dernière version pour reprendre les
                  modifications.
                </p>
                <button
                  className="button"
                  onClick={() => setReloadConfirm(true)}
                >
                  Recharger la dernière version
                </button>
              </div>
            )}
          </>
        )}
        {notice && (
          <p className="success-notice" role="status">
            <Check size={18} />
            {notice}
          </p>
        )}
        {sync && (
          <section className="sync-panel" aria-label="Synchronisation Discord">
            <strong>Synchronisation Discord</strong>
            <p>{buildingSyncMessage(sync, record.entity_key)}</p>
            {sync.error && <p className="form-error">{sync.error}</p>}
            <button className="button" disabled={syncBusy} onClick={checkSync}>
              {syncBusy ? "Vérification…" : "Vérifier la synchronisation"}
            </button>
          </section>
        )}
        {syncError && <ErrorNotice error={syncError} retry={checkSync} />}
        {tab === "general" && (
          <div className="editor-columns">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Identité du lieu</h2>
                  <p>Ce que vos joueurs reconnaîtront en premier.</p>
                </div>
              </div>
              <form
                id="building-form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={!writable || busy}>
                  <label htmlFor="building-name">
                    Nom du bâtiment <span className="required">*</span>
                  </label>
                  <input
                    id="building-name"
                    ref={name}
                    value={payload.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    aria-invalid={!!fieldError}
                    aria-describedby="name-error"
                    autoComplete="off"
                  />
                  <p id="name-error" className="form-error">
                    {fieldError}
                  </p>
                  <label htmlFor="building-description">Description</label>
                  <textarea
                    className="resize-none"
                    id="building-description"
                    rows={5}
                    value={payload.description ?? ""}
                    onChange={(e) => patch({ description: e.target.value })}
                    placeholder="Décrivez ce lieu et ce qui s’y passe…"
                  />
                  <div className="field-pair">
                    <label>
                      Symbole
                      <input
                        value={payload.emoji ?? ""}
                        onChange={(e) => patch({ emoji: e.target.value })}
                      />
                    </label>
                    <label>
                      Catégorie
                      <input
                        value={payload.category ?? ""}
                        onChange={(e) => patch({ category: e.target.value })}
                        placeholder="Ex. Commerce, lieu de rencontre"
                      />
                    </label>
                  </div>
                  {advanced && (
                    <>
                      <label>
                        Nature du bâtiment
                        <select
                          value={payload.entity_kind ?? "place"}
                          onChange={(e) =>
                            patch({ entity_kind: e.target.value })
                          }
                        >
                          {Object.entries({
                            place: "Lieu",
                            room: "Pièce",
                            institution: "Institution",
                            vehicle: "Véhicule",
                            planet: "Planète",
                            zone: "Zone",
                            abstract: "Entité abstraite",
                            custom: "Personnalisée",
                          }).map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Lieu du monde
                        <select
                          value={payload.location_key ?? ""}
                          onChange={(e) =>
                            patch({ location_key: e.target.value })
                          }
                        >
                          <option value="">Aucun lieu associé</option>
                          {payload.location_key &&
                            !references.data?.some(
                              (e) =>
                                e.entity_type === "location" &&
                                e.entity_key === payload.location_key,
                            ) && (
                              <option value={payload.location_key}>
                                Référence actuelle : {payload.location_key}
                              </option>
                            )}
                          {references.data
                            ?.filter((e) => e.entity_type === "location")
                            .map((e) => (
                              <option value={e.entity_key} key={e.entity_key}>
                                {e.payload.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  )}
                </fieldset>
              </form>
            </section>
            <aside>
              <section className="panel identity-preview">
                <span className="eyebrow">APERÇU D’IDENTITÉ</span>
                <span className="preview-emblem">{payload.emoji || "◇"}</span>
                <h2>{payload.name || "Votre bâtiment"}</h2>
                <p>{payload.description || "Sa description apparaîtra ici."}</p>
                <small>Aperçu Studio · Ceci n’est pas un rendu Discord.</small>
              </section>
              <section className="panel">
                <h3>Un lieu, plusieurs possibilités</h3>
                <p className="help">
                  L’identité et les données existantes partagent le même modèle
                  en modes guidé et avancé. Les mécaniques et les interfaces
                  historiques sont conservées lors de la sauvegarde.
                </p>
              </section>
            </aside>
          </div>
        )}
        {tab === "modules" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Modules et mécaniques</h2>
                <p>
                  Configuration actuelle du moteur, conservée sans conversion.
                </p>
              </div>
            </div>
            {modules.length ? (
              <div className="module-grid">
                {modules.map(([key, value]) => (
                  <article className="module-card" key={key}>
                    <Layers size={19} />
                    <h3>{moduleLabels[key] ?? key}</h3>
                    <p>
                      {Array.isArray(value)
                        ? `${value.length} éléments configurés`
                        : "Configuration présente"}
                    </p>
                    {Array.isArray(value) && (
                      <ul>
                        {value.slice(0, 8).map((item, i) => (
                          <li key={i}>
                            {typeof item === "object" && item
                              ? String(
                                  item.name ?? item.key ?? `Élément ${i + 1}`,
                                )
                              : String(item)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Aucune mécanique configurée">
                <p>
                  Ce bâtiment est vide. Les éditeurs de modules V3 constituent
                  la prochaine tranche.
                </p>
              </Empty>
            )}
            <p className="help">
              Pour modifier les mécaniques existantes, utilisez encore le
              Builder classique. Rechargez ensuite cette fiche avant de la
              modifier.
            </p>
            <a className="button" href="/">
              Ouvrir KingdomWeb classique <ArrowRight size={15} />
            </a>
          </section>
        )}
        {tab === "interfaces" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Interfaces Discord</h2>
                <p>Pages déclarées dans les données du bâtiment.</p>
              </div>
            </div>
            {pages.length ? (
              <div className="page-grid">
                {pages.map((page) => (
                  <article className="module-card" key={page.key}>
                    <LayoutTemplate size={20} />
                    <h3>{page.name || page.key}</h3>
                    <p>{page.components?.length ?? 0} composants configurés</p>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={
                  payload.interface_key
                    ? "Interface liée à une définition séparée"
                    : "Aucune page intégrée"
                }
              >
                <p>
                  {payload.interface_key
                    ? `L’interface ${String(payload.interface_key)} est conservée et reste éditable dans le Builder classique.`
                    : "L’éditeur visuel Discord complet sera développé dans la prochaine tranche."}
                </p>
              </Empty>
            )}
            <p className="help">
              Le rendu Components V2, les interactions et la simulation ne sont
              pas encore disponibles dans cette version du Studio.
            </p>
          </section>
        )}
        {tab === "data" && (
          <BuildingData
            entityKey={record.entity_key}
            saved={record.version > 0}
          />
        )}
        {tab === "relations" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Relations du bâtiment</h2>
                <p>Références conservées dans le modèle existant.</p>
              </div>
            </div>
            {references.error && (
              <ErrorNotice error={references.error} retry={references.reload} />
            )}
            <dl className="relation-list">
              {Object.entries({
                location_key: payload.location_key,
                parent_key: payload.parent_key,
                interface_key: payload.interface_key,
                ...(payload.relations ?? {}),
              })
                .filter(([, v]) => v !== "" && v !== undefined && v !== null)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {(
                        {
                          location_key: "Lieu",
                          parent_key: "Bâtiment parent",
                          interface_key: "Interface",
                          primary_profession_key: "Métier principal",
                          ambience_audio_key: "Ambiance",
                        } as Record<string, string>
                      )[key] ?? key}
                    </dt>
                    <dd>
                      {typeof value === "string"
                        ? (references.data?.find((e) => e.entity_key === value)
                            ?.payload.name ?? value)
                        : "Relation structurée conservée"}
                    </dd>
                  </div>
                ))}
            </dl>
            {!payload.location_key &&
              !payload.parent_key &&
              !payload.interface_key &&
              !Object.values(payload.relations ?? {}).some(Boolean) && (
                <Empty title="Aucune relation directe">
                  <p>
                    En mode avancé, vous pouvez associer le bâtiment à un lieu
                    existant.
                  </p>
                </Empty>
              )}
          </section>
        )}
      </div>
      <div className="save-bar">
        <div aria-live="polite">
          <span className={`signal ${dirty ? "pending" : ""}`} />
          {busy
            ? "Opération en cours…"
            : dirty
              ? "Modifications non enregistrées"
              : record.version
                ? "Toutes les modifications sont enregistrées"
                : "Nouveau bâtiment, non enregistré"}
        </div>
        <div>
          <button
            className="button"
            form="building-form"
            type="button"
            onClick={save}
            disabled={!writable || busy || (!dirty && record.version > 0)}
            aria-busy={busy}
          >
            <Save size={16} />
            Enregistrer le brouillon
          </button>
          <button
            className="button primary"
            onClick={() => setPublish(true)}
            disabled={
              !writable ||
              busy ||
              dirty ||
              !record.version ||
              record.status !== "draft"
            }
            title={
              dirty ? "Enregistrez le brouillon avant de publier." : undefined
            }
          >
            <Send size={16} />
            Publier
          </button>
        </div>
      </div>
      {publish && (
        <Dialog
          title={`Publier « ${record.payload.name} » ?`}
          onDismiss={() => !busy && setPublish(false)}
        >
          <p>
            La révision {record.version} deviendra active dans le monde{" "}
            <strong>{world.name}</strong>. Le moteur demandera la mise à jour du
            panneau Discord. Les stocks et la progression des joueurs seront
            conservés.
          </p>
          <div className="dialog-actions">
            <button
              className="button"
              autoFocus
              disabled={busy}
              onClick={() => setPublish(false)}
            >
              Annuler
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={publishSaved}
            >
              {busy ? "Publication…" : "Publier cette révision"}
            </button>
          </div>
        </Dialog>
      )}
      {block.state === "blocked" && (
        <Dialog
          title={
            busy ? "Une opération est en cours" : "Quitter sans enregistrer ?"
          }
          onDismiss={() => block.reset()}
        >
          <p>
            {busy
              ? "Attendez la réponse du moteur avant de changer de page ou de monde."
              : "Les modifications de cette fiche seront perdues. Le brouillon enregistré restera intact."}
          </p>
          <div className="dialog-actions">
            <button
              className="button primary"
              autoFocus
              onClick={() => block.reset()}
            >
              Rester sur la fiche
            </button>
            {!busy && (
              <button className="button" onClick={() => block.proceed()}>
                Quitter sans enregistrer
              </button>
            )}
          </div>
        </Dialog>
      )}
      {reloadConfirm && (
        <Dialog
          title="Recharger la dernière révision ?"
          onDismiss={() => setReloadConfirm(false)}
        >
          <p>
            Votre saisie non enregistrée sera remplacée par la révision du
            moteur.
          </p>
          <div className="dialog-actions">
            <button
              className="button"
              autoFocus
              onClick={() => setReloadConfirm(false)}
            >
              Conserver ma saisie
            </button>
            <button
              className="button primary"
              onClick={async () => {
                if (busy) return;
                setReloadConfirm(false);
                setBusy(true);
                setNotice("");
                try {
                  const latest = await api.get<Entity>(
                    `/api/content/building/${record.entity_key}`,
                  );
                  setRecord(latest);
                  setPayload(latest.payload);
                  setError(undefined);
                  setNotice("Dernière révision chargée.");
                } catch (e) {
                  setError(e as Error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Recharger
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function BuildingData({
  entityKey,
  saved,
}: {
  entityKey: string;
  saved: boolean;
}) {
  const { api } = useWorkspace();
  const resource = useResource<Overview>(api, "/api/admin/overview");
  if (!saved)
    return (
      <Empty title="Ce bâtiment n’est pas encore enregistré">
        <p>Enregistrez le brouillon pour lui donner une place dans le monde.</p>
      </Empty>
    );
  if (resource.loading) return <Loading />;
  if (resource.error)
    return <ErrorNotice error={resource.error} retry={resource.reload} />;
  const building = resource.data?.buildings.find((b) => b.key === entityKey);
  const changes =
    resource.data?.changes.filter(
      (c) => c.aggregate_type === "building" && c.aggregate_key === entityKey,
    ) ?? [];
  return (
    <div className="editor-columns">
      <section className="panel">
        <h2>Stock partagé</h2>
        <p>
          {building?.stock_total ?? 0} unités · {building?.pending ?? 0}{" "}
          activités en attente
        </p>
        {building?.stock.length ? (
          <dl className="relation-list">
            {building.stock.map((item) => (
              <div key={item.id}>
                <dt>{item.name}</dt>
                <dd>{item.quantity}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">Aucune ressource stockée.</p>
        )}
      </section>
      <section className="panel">
        <h2>Historique récent</h2>
        {changes.length ? (
          <ul className="history">
            {changes
              .slice()
              .reverse()
              .map((c) => (
                <li key={c.id}>
                  <strong>
                    {c.kind === "content.published"
                      ? "Révision publiée"
                      : "Brouillon enregistré"}
                  </strong>
                  <time dateTime={c.created_at}>{date(c.created_at)}</time>
                </li>
              ))}
          </ul>
        ) : (
          <p className="muted">Aucun changement dans l’historique récent.</p>
        )}
      </section>
    </div>
  );
}
