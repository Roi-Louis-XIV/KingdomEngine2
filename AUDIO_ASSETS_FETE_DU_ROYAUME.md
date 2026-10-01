# Production audio — La Fête du Royaume

Ce manifeste décrit le template officiel `royal_festival` révision 3 tel qu'il est réellement configuré. Les imports effectués depuis KingdomWeb sont stockés sous `assets/audio/servers/<serveur>/<cle>/source.<extension>`. Les formats acceptés sont MP3, WAV, OGG, FLAC, M4A, AAC et OPUS.

## Priorité 1 — jouable et déjà fourni

| Clé KingdomData | Fichier exact | Type | Lieu / personnage | Déclencheur configuré | Boucle | Volume | Durée attendue | Description de production |
|---|---|---|---|---|---:|---:|---|---|
| `preset_village_ambience` | `assets/village/ambience/ambiance_village.mp3` | ambiance | Place Royale | entrée / présence dans `market_square` | oui | 0,55 | boucle longue | Place vivante, conversations et activité légère. |
| `preset_forest_ambience` | `assets/forest/ambience/ambiance_foret.mp3` | ambiance | Camp de Sylvain | entrée / présence dans `forester_lodge` | oui | 0,55 | boucle longue | Forêt calme et exploitable sous une voix. |
| `preset_mine_ambience` | `assets/mine/ambience/ambiance mine.mp3` | ambiance | Mine de Roland | entrée / présence dans `deep_mine` | oui | 0,55 | boucle longue | Galeries, réverbération et travail lointain. |
| `preset_forge_ambience` | `assets/forge/ambience/sound_ambiance.mp3` | ambiance | Forge de Wagner | entrée / présence dans `royal_forge` | oui | 0,55 | boucle longue | Feu, métal et atelier en activité. |
| `preset_tavern_ambience` | `assets/tavern/ambience/ambiance_taverne.mp3` | ambiance | Taverne d'Edgar | entrée / présence dans `edgar_tavern` | oui | 0,55 | boucle longue | Salle commune chaleureuse et conversations. |
| `preset_farm_ambience` | `assets/village_normal_jour/source.mp3` | ambiance | Ferme du Royaume | entrée / présence dans `festival_farm` | oui | 0,55 | boucle longue | Campagne diurne et activité agricole. |
| `preset_festival_ambience` | `assets/tavern/music/music_fete_1.mp3` | ambiance musicale | Esplanade | entrée dans `festival_esplanade`; couche de `festival_opening` | oui | 0,55 | boucle musicale | Musique de célébration finale. |
| `festival_sfx_axe` | `assets/forest/sfx/axe_01.mp3` | effet | Camp de Sylvain | réussite de `gather_festival_wood` | non | 0,75 | ponctuel | Coup de hache net. |
| `festival_sfx_arrow` | `assets/forest/sfx/arrow_01.mp3` | effet | Camp de Sylvain | réussite de `hunt_game` | non | 0,70 | ponctuel | Départ d'une flèche. |
| `festival_sfx_pickaxe` | `assets/mine/sfx/pickaxe_01.mp3` | effet | Mine de Roland | réussite de `extract_festival_ore` | non | 0,75 | ponctuel | Impact de pioche sur roche. |
| `festival_sfx_beer` | `assets/tavern/sfx/biere rempli.mp3` | effet | Taverne d'Edgar | réussite de `brew_festival_drinks` | non | 0,70 | ponctuel | Remplissage d'une chope. |
| `festival_voice_edgar_welcome` | `assets/tavern/welcome/Edgar_bienvenue.mp3` | voix | Edgar | interaction `talk`, variante `welcome` | non | 1,00 | une réplique | Accueil d'Edgar. |
| `festival_voice_roland_welcome` | `assets/mine/welcome/welcome mine.mp3` | voix | Roland | interaction `talk`, variante `welcome` | non | 1,00 | une réplique | Accueil du contremaître. |
| `festival_voice_wagner_welcome` | `assets/forge/welcome/bonjour_forge_1.mp3` | voix | Wagner | interaction `talk`, variante `welcome` | non | 1,00 | une réplique | Accueil du maître forgeron. |
| `festival_voice_maelis_welcome` | `assets/village/welcome/welcome_01.mp3` | voix | Maëlis | interaction `talk`, variante `welcome` | non | 1,00 | une réplique | Accueil à la Place Royale. |

## Priorité 2 — voix à fournir

Importer chaque fichier par **Sons & musiques**, type **Voix**, puis l'associer à la variante indiquée dans la fiche du personnage. Le moteur génère alors un chemin `assets/audio/servers/<serveur>/<cle>/source.<extension>`.

| Clé conseillée | Personnage | Déclencheur existant | Texte à enregistrer | Variantes souhaitées |
|---|---|---|---|---|
| `festival_voice_sylvain_welcome` | Sylvain | `talk` / `welcome` | « La forêt donnera son bois, si nous la traitons avec respect. » | calme, pluie |
| `festival_voice_agathe_welcome` | Agathe | `talk` / `welcome` | « Chaque récolte compte pour nourrir la fête. » | beau temps, mauvaise récolte |
| `festival_voice_edgar_work` | Edgar | `activity_success` / `brew_festival_drinks` | « Voilà de quoi désaltérer le royaume ! » | normale, heure joyeuse |
| `festival_voice_roland_work` | Roland | `activity_success` / `extract_festival_ore` | « Beau travail. La galerie tiendra. » | normale, incident minier |
| `festival_voice_wagner_work` | Wagner | `activity_success` / `forge_festival_brazier` | « Ce brasero brûlera jusqu'au bout de la nuit. » | normale, incident de forge |
| `festival_voice_agathe_work` | Agathe | `activity_success` / `harvest_festival_wheat` | « Les greniers se remplissent. Continuez ! » | normale, bonne récolte |
| `festival_voice_maelis_work` | Maëlis | `activity_success` / `fund_festival` | « Votre contribution rapproche tout le royaume de la fête. » | progression faible, forte |

## Priorité 3 — enrichissements

| Clé conseillée | Type | Lieu / événement | Déclencheur à configurer | Boucle | Description |
|---|---|---|---|---:|---|
| `festival_weather_rain` | ambiance | extérieurs | couche météo `rain` | oui | Pluie lisible, sans masquer les voix. |
| `festival_weather_storm` | ambiance | royaume | couche événement `festival_storm` | oui | Vent, pluie forte et tonnerre espacés. |
| `festival_event_announcement` | voix | Crieur public | activation `festival_announcement` | non | Annonce des préparatifs de la Grande Fête. |
| `festival_event_finale` | musique | Esplanade | activation `festival_opening` | oui | Variante plus ample que l'ambiance courante. |
| `festival_sfx_hammer` | effet | Forge | `forge_festival_brazier` | non | Marteau sur enclume. |
| `festival_sfx_mill` | effet | Ferme / moulin | `mill_festival_flour` | non | Meule et grain. |
| `festival_sfx_deposit` | effet | Esplanade | actions `deposit_festival_*` | non | Caisse ou sac déposé, court et neutre. |

## Checklist de livraison

- [ ] Conserver exactement les clés KingdomData du tableau lors de l'import.
- [ ] Vérifier que chaque ambiance boucle sans clic ni silence audible.
- [ ] Normaliser les voix entre elles avant réglage du volume dans KingdomWeb.
- [ ] Tester les effets simultanément avec une ambiance et une Voice Presence.
- [ ] Tester `festival_rain`, `festival_storm` et `festival_opening` depuis l'éditeur d'événements.
- [ ] Vérifier la libération puis la réallocation du Voice Worker en changeant de bâtiment.

## Audio non actuellement supporté

- Un déclenchement automatique aléatoire dans une **fenêtre de minutes** n'est pas exécuté nativement : `recommended_window_minutes` sert de recommandation Live Ops et l'événement reste manuel.
- Le choix automatique d'une réplique différente selon le **pourcentage global exact** de l'objectif collectif n'est pas encore une condition générique du moteur de réactions.
- Aucun asset absent n'est simulé par un chemin fictif : les profils concernés restent explicitement marqués `À fournir` dans KingdomWeb.
