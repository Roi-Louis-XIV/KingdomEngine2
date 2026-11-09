/** Mini-boîte à outils d'interface, sans dépendance. */

type Child = Node | string | number | false | null | undefined | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Crée un élément : h('button', { class: 'btn', onclick: fn }, 'Texte'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as HTMLInputElement).checked = !!v;
    else if (k === 'selected') (el as HTMLOptionElement).selected = !!v;
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------------------
// Retours
// ---------------------------------------------------------------------------

export function toast(text: string, kind: 'ok' | 'error' | 'info' = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) document.body.append((host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' })));
  const t = h('div', { class: `toast ${kind}` }, text);
  host.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3200);
  setTimeout(() => t.remove(), kind === 'error' ? 6500 : 3700);
}

/** Fenêtre modale. Retourne une fonction de fermeture. */
export function modal(title: string, body: Child, actions: { label: string; kind?: string; onclick: (close: () => void) => void | Promise<void> }[] = []) {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', null, title),
    h('div', { class: 'modal-body' }, body),
    h(
      'div',
      { class: 'modal-actions' },
      h('button', { class: 'btn ghost', onclick: close }, 'Annuler'),
      actions.map((a) =>
        h(
          'button',
          {
            class: `btn ${a.kind ?? 'primary'}`,
            onclick: async (e: Event) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.disabled = true;
              try {
                await a.onclick(close);
              } finally {
                b.disabled = false;
              }
            },
          },
          a.label,
        ),
      ),
    ),
  );
  const overlay = h('div', { class: 'overlay' }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  (dialog.querySelector('input, select, textarea, .btn.primary, .btn.danger') as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(title: string, text: string, label: string, kind = 'danger'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(title, h('p', null, text), [
      {
        label,
        kind,
        onclick: (c) => {
          done = true;
          c();
          resolve(true);
        },
      },
    ]);
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.overlay')) {
        obs.disconnect();
        if (!done) resolve(false);
      }
    });
    obs.observe(document.body, { childList: true });
    void close;
  });
}

// ---------------------------------------------------------------------------
// Champs de formulaire liés à un objet
// ---------------------------------------------------------------------------

export interface FieldOpts {
  label?: string;
  hint?: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'color' | 'textarea' | 'password';
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  disabled?: boolean;
  wide?: boolean;
}

/** Champ texte ou nombre qui écrit dans obj[key] et appelle onChange. */
export function field<T extends object>(obj: T, key: keyof T & string, opts: FieldOpts, onChange: () => void) {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  const value = (obj as Record<string, unknown>)[key];
  const set = (v: unknown) => {
    if (v === '' || v === undefined) delete (obj as Record<string, unknown>)[key];
    else (obj as Record<string, unknown>)[key] = v;
    onChange();
  };
  let input: HTMLInputElement | HTMLTextAreaElement;
  if (opts.type === 'textarea') {
    input = h('textarea', { id, rows: 3, placeholder: opts.placeholder, disabled: opts.disabled }) as HTMLTextAreaElement;
    input.value = value === undefined ? '' : String(value);
    input.addEventListener('input', () => set(input.value));
  } else if (opts.type === 'color') {
    const n = typeof value === 'number' ? value : 0x6fb59a;
    input = h('input', { id, type: 'color', value: '#' + n.toString(16).padStart(6, '0'), disabled: opts.disabled });
    input.addEventListener('input', () => set(parseInt(input.value.slice(1), 16)));
  } else {
    input = h('input', {
      id,
      type: opts.type ?? 'text',
      value: value === undefined ? '' : String(value),
      placeholder: opts.placeholder,
      min: opts.min,
      max: opts.max,
      step: opts.step,
      required: opts.required,
      disabled: opts.disabled,
    });
    input.addEventListener('input', () => {
      const raw = input.value;
      if (opts.type === 'number') set(raw === '' ? undefined : Number(raw));
      else set(raw);
    });
  }
  return h(
    'label',
    { class: `field${opts.wide ? ' wide' : ''}`, for: id },
    opts.label ? h('span', { class: 'field-label' }, opts.label) : null,
    input,
    opts.hint ? h('span', { class: 'field-hint' }, opts.hint) : null,
  );
}

export function selectField(label: string | null, value: string, options: { value: string; label: string }[], onChange: (v: string) => void, opts: { hint?: string; allowEmpty?: string } = {}) {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  const sel = h(
    'select',
    { id, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    opts.allowEmpty !== undefined ? h('option', { value: '', selected: !value }, opts.allowEmpty) : null,
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  if (!label) return sel;
  return h('label', { class: 'field', for: id }, h('span', { class: 'field-label' }, label), sel, opts.hint ? h('span', { class: 'field-hint' }, opts.hint) : null);
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(ts: number | null | undefined): string {
  if (!ts) return 'jamais';
  const s = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'à l’instant';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export const dateTime = (ts: number) => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  return ((words[0]?.[0] ?? name[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

/** Identifiant technique dérivé d'un nom (« Chope de bière » → chope-de-biere). */
export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'element'
  );
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  let id = slug(base);
  for (let i = 2; set.has(id); i++) id = `${slug(base)}-${i}`;
  return id;
}

export function emptyState(title: string, text: string, action?: { label: string; onclick: () => void }) {
  return h('div', { class: 'empty' }, h('h3', null, title), h('p', null, text), action ? h('button', { class: 'btn primary', onclick: action.onclick }, action.label) : null);
}
