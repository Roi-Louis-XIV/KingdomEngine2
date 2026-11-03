import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { ApiClient, ApiError } from "../api";

export function Loading({
  label = "Chargement du monde…",
}: {
  label?: string;
}) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {label}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onDismiss,
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => {
      node?.close();
      queueMicrotask(() => {
        const trigger = restoreFocus.current;
        if (trigger?.isConnected && !trigger.matches(":disabled"))
          trigger.focus();
        else document.getElementById("main-content")?.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const errorId = useId();
  const passwordId = useId();
  const username = useRef<HTMLInputElement>(null);
  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        if (!form.get("username") || !form.get("password")) {
          setError("Renseignez votre identifiant et votre mot de passe.");
          username.current?.focus();
          return;
        }
        setBusy(true);
        setError("");
        try {
          await new ApiClient().post("/api/auth/login", {
            username: form.get("username"),
            password: form.get("password"),
            remember: form.get("remember") === "on",
          });
          onSuccess();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Identifiant
        <input
          ref={username}
          name="username"
          autoComplete="username"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      <label htmlFor={passwordId}>Mot de passe</label>
      <span className="password-field">
        <input
          id={passwordId}
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-pressed={show}
        >
          {show ? "Masquer" : "Afficher"}
        </button>
      </span>
      <label className="check">
        <input type="checkbox" name="remember" />
        Rester connecté pendant 7 jours
      </label>
      <p id={errorId} className="form-error" role={error ? "alert" : undefined}>
        {error}
      </p>
      <button
        className="button primary"
        type="submit"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const [login, setLogin] = useState(false);
  const expired = error instanceof ApiError && error.status === 401;
  return (
    <>
      <div className="error-notice" role="alert">
        <AlertCircle size={20} />
        <div>
          <strong>
            {expired
              ? "Votre session a expiré"
              : "Cette opération n’a pas abouti"}
          </strong>
          <p>{error.message}</p>
          <button
            className="button"
            onClick={() => (expired ? setLogin(true) : retry())}
          >
            {expired ? "Se reconnecter" : "Réessayer"}
          </button>
        </div>
      </div>
      {login && (
        <Dialog
          title="Retrouver votre session"
          onDismiss={() => setLogin(false)}
        >
          <p>Vos modifications restent ouvertes.</p>
          <LoginForm
            onSuccess={() => {
              setLogin(false);
              retry();
            }}
          />
          <button className="button ghost" onClick={() => setLogin(false)}>
            Fermer
          </button>
        </Dialog>
      )}
    </>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ◇
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      {(
        {
          draft: "Brouillon",
          published: "Publié",
          archived: "Archivé",
        } as Record<string, string>
      )[status] ?? status}
    </span>
  );
}
export function Search({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="search">
      <label className="sr-only" htmlFor="catalog-search">
        Rechercher dans la bibliothèque
      </label>
      <input
        id="catalog-search"
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher un nom, une catégorie…"
      />
      {value && (
        <button
          aria-label="Effacer la recherche"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
