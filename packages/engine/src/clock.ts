/**
 * Horloge du monde : fuseau horaire, prochaines programmations, tirage de la météo.
 * Fonctions pures, utilisables dans le navigateur comme sur le serveur.
 */
import type { EventSchedule, WeatherDef, WeatherState } from './model.ts';

export const DEFAULT_TZ = 'Europe/Paris';

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  dow: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    formatters.set(tz, f);
  }
  return f;
}

/** Date et heure locales d'un instant dans un fuseau. */
export function zoned(ts: number, tz = DEFAULT_TZ): Parts {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!);
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, dow };
}

/** Décalage du fuseau (ms) à un instant donné. */
function offset(ts: number, tz: string): number {
  const z = zoned(ts, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi);
  return asUtc - Math.floor(ts / 60_000) * 60_000;
}

/** Instant UTC correspondant à une heure locale (gère les changements d'heure). */
export function localToUtc(y: number, m: number, d: number, h: number, mi: number, tz = DEFAULT_TZ): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ts = guess - offset(guess, tz);
  ts = guess - offset(ts, tz);
  return ts;
}

export function parseHHMM(s: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1]!;
  const mi = +m[2]!;
  return h < 24 && mi < 60 ? { h, mi } : null;
}

/** Interprète une date ISO ; sans fuseau explicite, elle est lue dans le fuseau du monde. */
export function parseLocalIso(s: string, tz = DEFAULT_TZ): number | null {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  return m ? localToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz) : null;
}

/**
 * Prochain déclenchement strictement après `from`.
 * `lastStart` sert aux intervalles (sinon on part de `from`).
 */
export function nextRun(schedule: EventSchedule, from: number, tz = DEFAULT_TZ, lastStart?: number): number | null {
  switch (schedule.type) {
    case 'manual':
      return null;
    case 'once': {
      const t = parseLocalIso(schedule.at, tz);
      return t !== null && t > from ? t : null;
    }
    case 'interval': {
      const every = Math.max(1, schedule.everyMinutes) * 60_000;
      if (lastStart === undefined) return from + every;
      // Rattrape les créneaux manqués (serveur éteint) sans les rejouer.
      let t = lastStart + every;
      if (t <= from) t += Math.ceil((from - t + 1) / every) * every;
      return t;
    }
    case 'daily': {
      const hm = parseHHMM(schedule.at);
      if (!hm) return null;
      const today = zoned(from, tz);
      for (let i = 0; i < 9; i++) {
        const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
        const dow = day.getUTCDay();
        if (schedule.days?.length && !schedule.days.includes(dow)) continue;
        const t = localToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hm.h, hm.mi, tz);
        if (t > from) return t;
      }
      return null;
    }
  }
}

/** Tire le prochain temps (différent de l'actuel si possible) et sa durée. */
export function rollWeather(def: WeatherDef, current: string | undefined, random: () => number): { state: WeatherState; minutes: number } | null {
  const pool = def.states.filter((s) => s.weight > 0 && (def.states.length < 2 || s.value !== current));
  const list = pool.length ? pool : def.states.filter((s) => s.weight > 0);
  if (!list.length) return null;
  const total = list.reduce((a, s) => a + s.weight, 0);
  let x = random() * total;
  let state = list[list.length - 1]!;
  for (const s of list) {
    x -= s.weight;
    if (x < 0) {
      state = s;
      break;
    }
  }
  const lo = Math.max(1, Math.min(state.minMinutes, state.maxMinutes));
  const hi = Math.max(lo, state.maxMinutes);
  return { state, minutes: Math.round(lo + random() * (hi - lo)) };
}

export function describeSchedule(s: EventSchedule): string {
  const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  switch (s.type) {
    case 'manual':
      return 'Manuel';
    case 'daily':
      return `${s.days?.length && s.days.length < 7 ? s.days.map((d) => DAYS[d]).join(', ') : 'Tous les jours'} à ${s.at}`;
    case 'interval':
      return s.everyMinutes % 60 === 0 ? `Toutes les ${s.everyMinutes / 60} h` : `Toutes les ${s.everyMinutes} min`;
    case 'once':
      return `Le ${s.at.replace('T', ' à ').slice(0, 19)}`;
  }
}
