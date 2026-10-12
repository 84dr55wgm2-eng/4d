# Resume state

_Last pass: 2026-10-12 — studio de lieux (correction « séparer le studio du contenu GTA »)._

**La mission visuelle GTA reste incomplète** : aucun contenu GTA réel n’a été importé ni affiché. Tout ce qui est
montré ci-dessous tourne sur le **paquet de test** (ville factice construite ici, textures CC0, CesiumMan CC BY) ;
ce n’est pas une scène GTA. Le lecteur GTA n’est pas déclaré validé.

## Ouvrir le studio
- `https://84dr55wgm2-eng.github.io/4d/` sans paramètre ouvre le dernier lieu assemblé, sinon un **lieu vide**
  (plus le quartier Yaba ni l’acteur RPM par défaut). Bouton **Lieux** : Sources · Catalogue · Assemblage · Agent.
- Bistro et Yaba restent ouverts par `?world=bistro` / `?world=yaba` (vérifié après cette passe).

## Matrice des capacités
✅ = implémenté et vérifié avec le contenu de test · ⚪ = implémenté, non exercé · ⛔ = bloqué par une entrée manquante.
Aucune ligne n’est vérifiée sur du contenu GTA (colonne GTA : « — » partout).

| Capacité | Contenu de test | GTA réel | Preuve / blocage |
|---|---|---|---|
| Sources : liste des paquets, stockage (OPFS/IDB), quota, persistance | ✅ | — | scénario `place-a` (OPFS, 10,9 Mo) |
| Import paquet préparé par adresse (site, service) | ✅ | — | `place-a`, `place-d` |
| Import paquet préparé par fichier / dossier | ⚪ | — | même chemin d’écriture que l’adresse ; sélecteurs non pilotés en headless |
| Repli IndexedDB sans OPFS | ⚪ | — | Chromium de test a OPFS |
| Import d’archives brutes : seulement via service privé, affiché seulement s’il répond | ✅ (job « fixture ») | ⛔ | `place-d` : job région → `blocked / game_files_missing` |
| cw-extract (CodeWalker.Core 485d56b) keys/scan/index/extract/region | ⚪ (compile) / ✅ xml-check | ⛔ | fichiers du jeu + exécutable |
| Conversion Sollumz → glTF | ⚪ (script écrit, jamais exécuté) | ⛔ | Blender ≥ 4.2 + Sollumz sur la machine B |
| Constructeur de paquet (ensembles, raccords, LOD, intérieurs, voies YND) | ✅ (XML canonisé par CodeWalker) | ⛔ | 22 ensembles, 27 ressources, 0 drawable manquant |
| Catalogue : recherche (synonymes FR), inspection, mesuré vs déduit | ✅ | — | `assembly.test.ts`, `place-a/b` |
| Résolution des dépendances (archétypes → ytyp/ydr/ytd, tuiles YND) | ⚪ (deps.mjs) / ✅ côté paquet | ⛔ | non exécuté sur des index GTA |
| Placement, transformations, raccords, remplacement, retrait, masquage | ✅ | — | Node test + navigateur |
| Opérations Pascal (contrat AgentOperation, applySceneChanges, mergeSceneChanges, refus, findValidPlacement) | ✅ | — | `src/vendor/pascal`, transactions `apply_plan` |
| Vérification : chevauchement, jonctions, marches, portes, accessibilité à pied (navmesh) | ✅ | — | a détecté la porte du café infranchissable → corrigé dans la fixture |
| Sauvegarde, réouverture, annulation | ✅ | — | undo/redo 9→0→9 ; état identique après rechargement (l’historique d’annulation ne survit pas au rechargement) |
| Caméra suivi : orbite manuelle conservée, Recentrer, zoom borné, murs/plafonds par la collision | ✅ | — | `place-a` : orientation gardée pendant la marche |
| Simulation : foule Detour (destinations, attentes, reprise après blocage), clients entrent/sortent, sièges exclusifs, véhicules sur voies qui s’arrêtent, horloge partagée, instantané sauvegardé | ✅ | — | `place-a` : sièges 3/5 occupés, véhicule arrêté devant un piéton |
| Réalisation : figurants et personnage dans une séquence, lecture / arrêt / reprise / positionnement, capture | ✅ | — | `place-c` ; export vidéo non relancé cette passe |
| Agent : boucle d’outils sur l’état réel (chercher, inspecter, placer, raccorder, vérifier, sélectionner, annuler, sauver, réaliser) | ✅ avec fournisseur **scripté** (pas un modèle) | — | `place-b` : appel refusé remonté en échec |
| Agent : modèle réel | ⛔ | ⛔ | relais non déployé : `ANTHROPIC_API_KEY`, `RELAY_TOKEN`, hébergement |
| Relais : `provider_not_configured` sans clé | ✅ | — | test local de `server/agent-relay` |

## Entrées encore nécessaires pour ouvrir le premier contenu GTA
Voir `docs/gta-pipeline.md` : machine B (Docker ou .NET 8 + Node + Blender 4.2 + Sollumz épinglé), installation PC
de GTA V possédée avec son exécutable (montée en lecture seule), `CONVERT_TOKEN`, une zone X/Y. Puis dans le studio :
Sources → adresse + jeton du service → « Extraire et convertir » → « Importer ».

## Limites connues
- Personnage de test : un seul clip (marche) ; l’attente et l’assise utilisent une pose figée.
- Les lieux assemblés flottent sur le ciel (pas de terrain au-delà des ensembles).
- Les carrefours du paquet de test n’ont pas de voies : les véhicules font demi-tour en bout de rue.
- Le cache de conversion est par job (empreinte SHA-256 des originaux), pas encore partagé entre jobs.

## Prochaine opération
Sur la machine B du propriétaire : `docker build … && docker run … -v /chemin/GTAV:/game:ro` puis un job « region »
sur une petite zone ; corriger ce que la première conversion réelle révèle (matériaux Sollumz, LOD, voies YND).
