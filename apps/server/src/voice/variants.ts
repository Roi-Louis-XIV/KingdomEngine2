/**
 * Variantes de sons : une clé jouée par le monde (« foret-hache ») peut exister telle quelle dans la médiathèque,
 * ou en plusieurs prises numérotées (« foret-hache-1 », « foret-hache-2 »…). On en tire alors une au hasard,
 * jamais la même deux fois de suite : deux joueurs qui frappent en même temps n'entendent pas le même coup.
 */
export function variantsOf(key: string, available: Iterable<string>): string[] {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`);
  return [...available].filter((k) => re.test(k)).sort((a, b) => Number(a.slice(key.length + 1)) - Number(b.slice(key.length + 1)));
}

/** Une clé est fournie si elle existe telle quelle ou en au moins une variante numérotée. */
export const isProvided = (key: string, available: Set<string>) => available.has(key) || variantsOf(key, available).length > 0;

export class VariantPicker {
  private last = new Map<string, string>();
  private random: () => number;
  constructor(random: () => number = Math.random) {
    this.random = random;
  }
  /** La clé exacte si elle existe, sinon une variante au hasard (différente de la précédente quand c'est possible). */
  pick(key: string, available: Iterable<string>): string | undefined {
    const all = [...available];
    if (all.includes(key)) return key;
    const vars = variantsOf(key, all);
    if (!vars.length) return undefined;
    const prev = this.last.get(key);
    const pool = vars.length > 1 ? vars.filter((v) => v !== prev) : vars;
    const choice = pool[Math.floor(this.random() * pool.length)] ?? pool[0]!;
    this.last.set(key, choice);
    return choice;
  }
}
