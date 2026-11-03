# Vérifications V3 — 3 novembre 2026

Base V2 : `00778b78f4fc68ee012a78279ca339af357aaa7c`. Tests sur SQLite temporaires, aucun accès à une production.

| Contrôle | Résultat |
|---|---|
| `npm --prefix KingdomWebNext test` | 9 tests réussis |
| `npm --prefix KingdomWebNext run test:e2e` | 9 parcours Chromium réussis, dont Axe WCAG et mobile 390px |
| `npm --prefix KingdomWebNext run typecheck` | Réussi |
| `npm --prefix KingdomWebNext run build` | Réussi |
| Audit premium strict | 0 constat |
| Lint DESIGN.md officiel | 0 erreur, 8 avertissements de références de tokens non déclarées dans les composants YAML ; tokens utilisés dans CSS |
| pytest V3 ciblé | 3 réussites |
| pytest complet V3 | 364 réussites, 12 échecs |
| pytest complet référence V2 intacte | 361 réussites, les mêmes 12 échecs |

## Échecs backend reproduits sur la référence V2

La première extraction de la référence avait omis trois scripts racine ; les trois échecs supplémentaires correspondants ont été diagnostiqués puis les quatre tests du fichier `test_debian_startup.py` ont été rejoués avec succès après restitution des scripts. Un nouveau passage complet sur la référence complétée confirme le bilan ci-dessous.

Chaque échec ci-dessous a été observé également sur la V2 intacte avec les mêmes dépendances. Aucune assertion n’a été désactivée.

- `tests/test_engine.py::test_template_sync_refreshes_an_already_open_building_interface`
- `tests/test_festival_v1_completion.py::test_legacy_menus_render_and_show_all_products`
- `tests/test_festival_workshops.py::test_forge_smelt_craft_purchase_repair`
- `tests/test_festival_workshops.py::test_discord_category_selectors_and_profession_visibility`
- `tests/test_festival_workshops.py::test_existing_revision_three_catalog_is_updated_once`
- `tests/test_festival_workshops.py::test_restored_expeditions_require_job_and_persist_results[forester_lodge-hunter-clearing-curved_bow]`
- `tests/test_import_v1.py::test_all_v1_buildings_items_and_voice_profiles_are_discovered`
- `tests/test_import_v1.py::test_import_is_idempotent`
- `tests/test_import_v1.py::test_existing_v1_building_is_linked_without_losing_its_custom_parameters`
- `tests/test_import_v1.py::test_existing_forge_receives_workshop_interface_automatically`
- `tests/test_player_admin.py::test_activity_interface_shows_locked_zones_but_filters_them_from_selector`
- `tests/test_web_editing.py::test_building_editor_exposes_beginner_wizard_and_presets`

Causes observées : archive/source V1 externe absente (4 imports), menus historiques dépassant la limite actuelle de 40 enfants Discord, catalogue/produits indisponibles, sélecteur de zone absent, synchronisation de template attendant un embed inexistant, révision officielle non idempotente, assertion textuelle de l’ancien frontend. Ces défauts historiques restent ouverts ; aucune validation Discord réelle n’est revendiquée.

## Relecture indépendante

Trois problèmes importants confirmés et corrigés avec tests ayant échoué avant correction : autorisation administrateur, résultat Discord associé au bon scope/bâtiment et gel du formulaire durant un rechargement de conflit. Un défaut supplémentaire de restitution du focus a été trouvé par Playwright et corrigé dans le dialogue partagé. Aucun autre constat bloquant de la relecture.

Captures générées par les tests : `KingdomWebNext/test-results/desktop-dashboard.png`, `KingdomWebNext/test-results/mobile-editor.png` (artefacts locaux ignorés par Git).
