import { h, clear, field, toast } from '../ui.ts';
import { get, post } from '../api.ts';
import { state } from '../store.ts';

/** Connexion / création du premier compte. */
export function authPage(onDone: () => void): HTMLElement {
  let mode: 'login' | 'register' = state.firstRun ? 'register' : 'login';
  const form = { username: '', password: '', displayName: '', remember: false };
  const box = h('div', { class: 'auth-card' });
  const draw = () => {
    const register = mode === 'register';
    clear(
      box,
      h('div', { class: 'auth-crest', 'aria-hidden': 'true' }, 'K'),
      h('h1', null, state.firstRun ? 'Bienvenue dans KingdomEngine' : register ? 'Créer un compte' : 'Connexion au Studio'),
      h(
        'p',
        { class: 'muted' },
        state.firstRun ? 'Crée le premier compte : il administrera cette installation.' : register ? 'Ton compte te permettra de créer et superviser tes mondes.' : 'Conçois et supervise tes mondes Discord.',
      ),
      h(
        'form',
        {
          class: 'form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const btn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement;
            btn.disabled = true;
            try {
              await post(register ? '/api/auth/register' : '/api/auth/login', form);
              onDone();
            } catch (err) {
              toast((err as Error).message, 'error');
              btn.disabled = false;
            }
          },
        },
        field(form, 'username', { label: 'Identifiant', required: true }, () => {}),
        register ? field(form, 'displayName', { label: 'Nom affiché', placeholder: 'Facultatif' }, () => {}) : null,
        field(form, 'password', { label: 'Mot de passe', type: 'password', required: true, hint: register ? '8 caractères minimum.' : undefined }, () => {}),
        !register
          ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e: Event) => (form.remember = (e.target as HTMLInputElement).checked) }), 'Rester connecté 7 jours')
          : null,
        h('button', { class: 'btn primary block', type: 'submit' }, register ? 'Créer le compte' : 'Se connecter'),
      ),
      !state.firstRun && state.registration
        ? h('button', { class: 'link', onclick: () => ((mode = register ? 'login' : 'register'), draw()) }, register ? 'J’ai déjà un compte' : 'Créer un compte')
        : null,
    );
    (box.querySelector('input') as HTMLInputElement | null)?.focus();
  };
  draw();
  return h('div', { class: 'auth' }, box);
}

/** Création d'un serveur (monde) depuis un modèle. */
export async function newServerPage(main: HTMLElement, onCreated: (id: string) => void) {
  const templates = await get<{ id: string; name: string; description: string; buildings: number }[]>('/api/templates');
  const form = { name: '', guildId: '', template: templates.find((t) => t.id !== 'vierge')?.id ?? templates[0]?.id ?? 'vierge' };
  const cards = h('div', { class: 'template-grid', role: 'radiogroup', 'aria-label': 'Point de départ' });
  const drawCards = () =>
    clear(
      cards,
      templates.map((t) =>
        h(
          'button',
          { type: 'button', class: `template${t.id === form.template ? ' on' : ''}`, role: 'radio', 'aria-checked': String(t.id === form.template), onclick: () => ((form.template = t.id), drawCards()) },
          h('b', null, t.name),
          h('span', null, t.description),
          h('small', null, t.buildings ? `${t.buildings} bâtiment(s)` : 'Aucun contenu'),
        ),
      ),
    );
  drawCards();
  clear(
    main,
    h(
      'div',
      { class: 'page narrow' },
      h('h1', null, state.servers.length ? 'Ajouter un serveur' : 'Crée ton premier monde'),
      h('p', { class: 'lead' }, 'Un serveur Discord = un monde indépendant, avec ses joueurs, son contenu et ses réglages.'),
      h(
        'form',
        {
          class: 'form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              const s = await post('/api/servers', form);
              toast(`« ${s.name} » est prêt.`);
              onCreated(s.id);
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          },
        },
        field(form, 'name', { label: 'Nom du monde', required: true, placeholder: 'Le Royaume' }, () => {}),
        field(form, 'guildId', {
          label: 'Identifiant du serveur Discord',
          placeholder: 'Facultatif, modifiable plus tard',
          hint: 'Dans Discord : Paramètres › Avancés › Mode développeur, puis clic droit sur le serveur › Copier l’identifiant.',
        }, () => {}),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Point de départ'), cards),
        h('button', { class: 'btn primary', type: 'submit' }, 'Créer le monde'),
      ),
    ),
  );
}
