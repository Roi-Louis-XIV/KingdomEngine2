import { useEffect, useMemo, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  AudioLines,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { ApiClient, ApiError } from "./api";
import { canEdit } from "./model";
import type { Profile } from "./types";
import type { Workspace } from "./context";
import { useResource } from "./useResource";
import { Empty, ErrorNotice, Loading, LoginForm } from "./components/ui";

const navigation = [
  { path: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/monde", label: "Monde", icon: Compass },
  { path: "/studio", label: "Studio", icon: Sparkles },
  { path: "/scenarios", label: "Scénarios", icon: Workflow },
  { path: "/supervision", label: "Supervision", icon: Radio },
  { path: "/mediatheque", label: "Médiathèque", icon: AudioLines },
];
export function App() {
  const base = useMemo(() => new ApiClient(), []);
  const resource = useResource<Profile>(base, "/api/profile");
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const queryWorld = new URLSearchParams(location.search).get("world");
  const world = resource.data?.servers.find(
    (w) => w.slug === (queryWorld || resource.data?.current_server),
  );
  const api = useMemo(() => new ApiClient(world?.slug), [world?.slug]);
  const href = (path: string) =>
    `${path}?world=${encodeURIComponent(world?.slug ?? "")}`;
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const name =
      navigation.find(
        (n) => n.path !== "/" && location.pathname.startsWith(n.path),
      )?.label ?? "Tableau de bord";
    document.title = `${name} · ${world?.name ?? "KingdomWeb Next"}`;
  }, [location.pathname, world?.name]);
  if (resource.loading) return <Loading label="Connexion à votre Studio…" />;
  if (resource.error instanceof ApiError && resource.error.status === 401)
    return (
      <main className="login-page">
        <div className="login-brand">
          <span className="brand-symbol">K</span>
          <span>PAYEN STUDIO</span>
          <h1>Vos mondes prennent vie ici.</h1>
          <p>
            Créez, reliez, faites vivre.
            <br />
            Votre atelier Discord, réinventé.
          </p>
          <small>KingdomWeb Next · Version de développement</small>
        </div>
        <section className="login-card">
          <span className="eyebrow">KINGDOMENGINE V3</span>
          <h2>Ouvrir le Studio</h2>
          <p>Connectez-vous avec votre compte KingdomWeb.</p>
          <LoginForm onSuccess={resource.reload} />
          <a href="/">
            Ouvrir KingdomWeb classique <ChevronRight size={14} />
          </a>
        </section>
      </main>
    );
  if (resource.error)
    return (
      <main className="standalone">
        <ErrorNotice error={resource.error} retry={resource.reload} />
      </main>
    );
  const profile = resource.data!;
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Aller au contenu
      </a>
      <aside
        className={`sidebar ${menu ? "open" : ""}`}
        aria-label="Navigation principale"
      >
        <Link to={href("/")} className="brand">
          <span className="brand-symbol">K</span>
          <span>
            KingdomWeb<small>NEXT / CREATOR STUDIO</small>
          </span>
        </Link>
        <button
          className="mobile-close button ghost"
          onClick={() => setMenu(false)}
          aria-label="Fermer la navigation"
        >
          <X />
        </button>
        <span className="sidebar-caption">ESPACE DE CRÉATION</span>
        <nav>
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={href(path)} end={path === "/"}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="studio-note">
            <span className="signal" />
            Le moteur, vos univers.<small>Fondations V3 · Tranche 1</small>
          </div>
          <a href="/" className="legacy-link">
            <BookOpen size={17} />
            KingdomWeb classique
          </a>
          <details>
            <summary>
              <CircleHelp size={17} />À propos de cette version
            </summary>
            <p>
              La création de bâtiments est connectée au moteur. Les éditeurs
              spécialisés et le simulateur arriveront dans les prochaines
              tranches.
            </p>
          </details>
          <div className="account">
            <span className="avatar">
              {profile.account.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              {profile.account.display_name}
              <small>{world?.role ?? "Compte"}</small>
            </div>
            <button
              aria-label="Se déconnecter"
              title="Se déconnecter"
              onClick={() => navigate(href("/logout"))}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-toggle button ghost"
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
            aria-label="Ouvrir la navigation"
          >
            <Menu size={22} />
          </button>
          <div className="world-select">
            <span className="world-symbol">
              <Compass size={20} />
            </span>
            <label>
              MONDE ACTIF
              <select
                aria-label="Monde actif"
                value={world?.slug ?? ""}
                onChange={(e) =>
                  navigate(`/?world=${encodeURIComponent(e.target.value)}`)
                }
              >
                {!world && <option value="">Sélectionner un monde</option>}
                {profile.servers.map((w) => (
                  <option key={w.slug} value={w.slug}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="topbar-meta">
            <span className="badge">V3 · Développement</span>
            <span className="connection">Session connectée</span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {!world ? (
            <Empty title="Choisissez un monde accessible">
              <p>
                {queryWorld
                  ? "Ce monde n’est pas dans vos accès. Sélectionnez un autre monde ci-dessus."
                  : "Aucun monde n’est associé à votre compte."}
              </p>
              <a className="button" href="/">
                Gérer mes mondes dans KingdomWeb
              </a>
            </Empty>
          ) : (
            <div key={world.slug} className="world-content">
              <Outlet
                context={
                  {
                    api,
                    world,
                    profile,
                    href,
                    writable: canEdit(world),
                  } satisfies Workspace
                }
              />
            </div>
          )}
        </main>
        <footer>
          PAYEN STUDIO <span>KingdomEngine V3 · Vos données, votre monde.</span>
        </footer>
      </div>
    </div>
  );
}

export function Logout() {
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    new ApiClient()
      .post("/api/auth/logout", {})
      .then(() => window.location.assign("/next"))
      .catch(setError);
  }, [attempt]);
  return error ? (
    <ErrorNotice
      error={error}
      retry={() => {
        setError(undefined);
        setAttempt((n) => n + 1);
      }}
    />
  ) : (
    <Loading label="Déconnexion…" />
  );
}
