import { h, clear, field, toast } from '../ui.ts';
import { get, post } from '../api.ts';
import { state } from '../store.ts';
import { discordLogo } from './profile.ts';

/** Connexion / création du premier compte. */
export function authPage(onDone: () => void): HTMLElement {
  let mode: 'login' | 'register' = state.firstRun ? 'register' : 'login';
  // Avec Discord, l'identifiant et le mot de passe sont repliés (accès de secours).
  let showPassword = !state.discordLogin;
  const form = { username: '', password: '', displayName: '', remember: false };
  const box = h('div', { class: 'auth-card' });
  const remember = () =>
    h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: form.remember, onchange: (e: Event) => (form.remember = (e.target as HTMLInputElement).checked) }), 'Rester connecté 7 jours');
  const draw = () => {
    const register = mode === 'register';
    const passwordForm = h(
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
      !state.discordLogin && !register ? remember() : null,
      h('button', { class: `btn ${state.discordLogin ? '' : 'primary '}block`, type: 'submit' }, register ? 'Créer le compte' : 'Se connecter'),
    );
    clear(
      box,
      h('p', { class: 'auth-kicker' }, state.firstRun ? 'Première installation' : register ? 'Nouveau compte' : 'Studio'),
      h('h2', null, state.firstRun ? 'Bienvenue, bâtisseur' : register ? 'Rejoins le Studio' : 'Bon retour parmi nous'),
      h(
        'p',
        { class: 'auth-lead' },
        state.firstRun ? 'Crée le premier compte : il administrera cette installation.' : register ? 'Ton compte te permettra de créer et superviser tes mondes.' : 'Connecte-toi pour concevoir et superviser tes mondes.',
      ),
      state.discordLogin
        ? [
            h(
              'a',
              {
                class: 'btn block discord-btn',
                href: '/api/auth/discord/start',
                onclick: (e: Event) => {
                  e.preventDefault();
                  location.href = `/api/auth/discord/start${form.remember ? '?remember=1' : ''}`;
                },
              },
              discordLogo(),
              state.firstRun ? 'Créer le compte avec Discord' : 'Se connecter avec Discord',
            ),
            remember(),
            showPassword
              ? [h('p', { class: 'or' }, h('span', null, register ? 'ou crée un identifiant' : 'ou avec ton identifiant')), passwordForm]
              : h('button', { class: 'link auth-alt', onclick: () => ((showPassword = true), draw(), (box.querySelector('form input') as HTMLInputElement | null)?.focus()) }, 'Utiliser un identifiant et un mot de passe'),
          ]
        : passwordForm,
      !state.firstRun && state.registration
        ? h('button', { class: 'link auth-alt', onclick: () => ((mode = register ? 'login' : 'register'), draw()) }, register ? 'J’ai déjà un compte' : 'Créer un compte')
        : null,
    );
    if (!state.discordLogin) (box.querySelector('form input') as HTMLInputElement | null)?.focus();
  };
  draw();
  const brand = h(
    'aside',
    { class: 'auth-brand' },
    h(
      'div',
      { class: 'auth-brand-inner' },
      h('div', { class: 'auth-crest', 'aria-hidden': 'true' }, 'K'),
      h('h1', { class: 'auth-wordmark' }, 'KingdomEngine'),
      h('p', { class: 'auth-tagline' }, 'Des mondes vivants dans tes salons Discord.'),
      h(
        'ul',
        { class: 'auth-points' },
        h('li', null, h('span', { 'aria-hidden': 'true' }, '🏰'), h('div', null, h('b', null, 'Des lieux à visiter'), h('small', null, 'Chaque bâtiment est un salon vocal où l’on entre, travaille et commerce.'))),
        h('li', null, h('span', { 'aria-hidden': 'true' }, '🎙️'), h('div', null, h('b', null, 'Des personnages qui parlent'), h('small', null, 'Les PNJ rejoignent le vocal, vivent et réagissent au scénario.'))),
        h('li', null, h('span', { 'aria-hidden': 'true' }, '📜'), h('div', null, h('b', null, 'Sans écrire une ligne de code'), h('small', null, 'Quêtes, métiers, événements : tout se conçoit dans le Studio.'))),
      ),
    ),
    h('p', { class: 'auth-foot' }, 'Payen Studio'),
  );
  return h('div', { class: 'auth' }, brand, h('main', { class: 'auth-panel' }, box));
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
            const create = async (takeOver: boolean) => {
              const s = await post('/api/servers', { ...form, takeOver });
              toast(`« ${s.name} » est prêt.`);
              onCreated(s.id);
            };
            try {
              await create(false);
            } catch (err) {
              const holder = (err as { data?: { holder?: { name: string }; canTakeOver?: boolean } }).data;
              // Serveur Discord déjà relié à un de mes mondes : proposer de le reprendre.
              if (holder?.canTakeOver && holder.holder && confirm(`Ce serveur Discord est déjà relié au monde « ${holder.holder.name} ».\n\nLe détacher de ce monde (qui sera conservé, sans Discord) et le relier au nouveau monde ?`)) {
                try {
                  await create(true);
                } catch (e2) {
                  toast((e2 as Error).message, 'error');
                }
              } else toast((err as Error).message, 'error');
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
