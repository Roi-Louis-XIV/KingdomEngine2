/** Diagnostics des Voice Workers, sans dépendance à Discord (testables). */

/** Explication en français d'une connexion vocale qui n'aboutit pas. */
export function joinFailure(closeCode: number | undefined, perms?: { has(p: bigint): boolean } | null): string {
  const VIEW = 1n << 10n;
  const CONNECT = 1n << 20n;
  const SPEAK = 1n << 21n;
  if (perms && !perms.has(VIEW)) return 'Ne voit pas le salon vocal : donne-lui le rôle « 🎙️ Voix KingdomEngine » (Studio › Discord › ranger les salons).';
  if (perms && !perms.has(CONNECT)) return 'N’a pas le droit de se connecter à ce salon vocal.';
  if (perms && !perms.has(SPEAK)) return 'N’a pas le droit de parler dans ce salon vocal.';
  if (closeCode === 4017) return 'Discord exige le chiffrement DAVE : module @snazzah/davey manquant (mise à jour du programme).';
  if (closeCode === 4014) return 'Déconnecté du salon vocal par Discord (salon supprimé ou worker expulsé).';
  if (closeCode === 4006 || closeCode === 4009) return 'Session vocale refusée par Discord : nouvel essai automatique.';
  return `Connexion au salon vocal impossible en 20 s${closeCode ? ` (code Discord ${closeCode})` : ''} : vérifie les droits du rôle « 🎙️ Voix KingdomEngine » et le journal du serveur.`;
}

