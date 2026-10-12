# Studio de lieux — environnements, conversion GTA, relais d’inférence

Le studio public ne contient, ne télécharge et ne publie aucun fichier de jeu. Le contenu GTA n’existe que sur la
machine du propriétaire (environnement B) et dans son propre navigateur (environnement C).

| Environnement | Où | Contient | Ne contient jamais |
|---|---|---|---|
| **A — application publique** | GitHub Pages (`branch claude/amazing-mendel-bv6uox`) | UI, code du studio, schémas `cws-package`, lecteurs distribuables, paquet de **test** (ville factice, non GTA) | fichier Rockstar, clé, secret |
| **B — préparation** | machine du propriétaire (Docker ou installation locale) | fichiers du jeu (lecture seule), CodeWalker.Core, Blender + Sollumz, `tools/gta/service` | — (rien n’en sort sans action du propriétaire) |
| **C — données du projet** | navigateur du propriétaire : OPFS (sinon IndexedDB) | paquets importés, mondes assemblés, état de simulation, réglages (adresse/jeton du service et du relais) | rien n’est envoyé au site |

Importer un contenu privé ne donne pas automatiquement le droit de tout en faire : les usages ultérieurs (diffusion de
captures, vidéos, redistribution) restent à vérifier par le propriétaire selon la licence du jeu.

## Capacités, séparées
- **Import d’un paquet préparé** (`.cwspkg`/`.zip`, dossier, adresse privée) : dans le navigateur, onglet *Sources*.
  Le paquet est décompressé en flux, validé (`package.json` format `cws-package` v1, fichiers présents), stocké en
  OPFS ou, à défaut, IndexedDB ; le quota est vérifié avant écriture ; un dépassement n’abîme rien (zone de transit supprimée).
- **Import d’archives brutes du jeu (RPF)** : uniquement via le service de conversion de l’environnement B. Le
  panneau ne propose l’extraction qu’une fois que `/health` du service répond `canRun.region = true`.

## Ce qu’il faut fournir pour ouvrir le premier contenu GTA
1. **Une machine de conversion** (Linux x64 conseillé ; Windows possible) avec, au choix :
   - Docker → `tools/gta/service/Dockerfile` (Ubuntu 24.04, .NET SDK 8, Node, Blender 4.2.3, Sollumz épinglé) ;
   - ou une installation directe : .NET SDK 8, Node ≥ 20, Blender ≥ 4.2 avec l’extension **Sollumz** activée
     (révision `75d323e90f2c5f4ee0be20a991599fac3e951e82`, GPL-3, utilisée comme processus séparé).
2. **Une installation PC de GTA V possédée légalement** (édition Legacy ou Enhanced) avec l’exécutable
   (`GTA5.exe` / `GTA5_Enhanced.exe`, nécessaire pour dériver les clés des archives), montée en lecture seule.
3. **Un jeton** choisi par le propriétaire (`CONVERT_TOKEN`).
4. **Une zone** à convertir en coordonnées du jeu (X0,Y0,X1,Y1, mètres, Z vers le haut).

Rien de tout cela n’est installé par le studio, et aucun compte ni service payant n’est créé.

## Commandes (environnement B)
```bash
# une fois : CodeWalker épinglé (MIT, dexyfex) puis l’extracteur .NET
tools/gta/fetch-codewalker.sh                       # 485d56bec00262ed7fa472261cce7bbc6202b96e → tools/gta/vendor (ignoré par git)
dotnet build -c Release tools/gta/cw-extract

# service privé (n’écoute que sur 127.0.0.1 par défaut ; ALLOW_ORIGIN = le site public)
CONVERT_TOKEN=… GAME_DIR=/chemin/GTAV BLENDER=blender node tools/gta/service/server.mjs
# ou : docker build -t cws-convert -f tools/gta/service/Dockerfile .
#      docker run --rm -p 127.0.0.1:8787:8787 -e CONVERT_TOKEN=… -v /chemin/GTAV:/game:ro -v cws-jobs:/jobs cws-convert

# étapes à la main (ce que fait un job « region »)
CW=tools/gta/cw-extract/bin/Release/net8.0/cw-extract
$CW keys    --game $GAME --work $W            # clés dérivées de l’exécutable → work/state/aes.key
$CW scan    --game $GAME --work $W            # inventaire reprenable des RPF (priorité update > dlc patch > dlc > base)
$CW index   --game $GAME --work $W            # ymaps.jsonl (étendues, parents LOD) + archetypes.jsonl
$CW region  --work $W --bbox x0,y0,x1,y1 --max 40
$CW extract --game $GAME --work $W --list $W/region-ymaps.txt     # raw/ (originaux) + xml/ (CodeWalker XML) + .source.json
node tools/gta/service/deps.mjs $W            # archétypes → ytyp/ydr/ydd/yft/ytd + tuiles nodes*.ynd → deps.txt
$CW extract --game $GAME --work $W --list $W/deps.txt
blender --background --factory-startup --python tools/gta/blender/sollumz_to_gltf.py -- --in $W/xml --out $W/gltf
npx tsx tools/gta/pack/build-package.ts --in $W --out $W/../package --id gta5.zone --name "Zone" --source gta5
```

## API du service (jeton `Authorization: Bearer …`)
| Route | Effet |
|---|---|
| `GET /health` | ce qui peut tourner : jeu, exécutable, cw-extract, Blender, Sollumz, liste `missing` |
| `POST /jobs {kind:'region', bbox, name, maxYmaps?, gen9?, keepIntermediate?}` | crée un job (étapes : keys, scan, index, region, extract-maps, deps, extract-deps, convert, pack, cleanup) |
| `POST /jobs {kind:'fixture'}` | job de test (ville factice, aucun fichier de jeu) |
| `GET /jobs`, `GET /jobs/:id` | état, étape en cours, dernière ligne de progression, erreur |
| `POST /jobs/:id/resume` | reprend à la première étape non terminée (chaque étape est elle-même reprenable) |
| `GET /jobs/:id/package` | le `.cwspkg` (téléchargement privé vers le navigateur du propriétaire) |
| `DELETE /jobs/:id` | arrête et supprime les fichiers du job |

Erreurs typées : `game_files_missing`, `game_executable_missing`, `blender_missing`, `step_failed` (avec l’étape et
le journal `<étape>.log`). Reprise : redémarrer le service relance les jobs « running ». Nettoyage : l’étape
`cleanup` supprime `raw/`, `xml/`, `gltf/` sauf `keepIntermediate`. Cache : chaque original extrait reçoit
son empreinte SHA-256 (`<nom>.source.json`, avec l’archive et le chemin d’origine) ; une conversion reprise ne refait
que les ressources dont l’empreinte a changé (`convert-state.json`). Le cache vit dans le répertoire du job (pas encore
partagé entre jobs). Les originaux restent conservés en provenance tant que `keepIntermediate` est demandé.

## Relais d’inférence (agent)
`server/agent-relay` (Node, SDK Anthropic). Il garde la clé, fixe le modèle et le prompt système, et ne relaie
qu’un tour à la fois ; les outils s’exécutent dans le navigateur, sur l’état réel du studio.

Paramètres à fournir pour le brancher (aucun n’existe aujourd’hui ; aucune infrastructure d’inférence préexistante) :
1. un hébergement Node ou conteneur choisi par le propriétaire (le `Dockerfile` est fourni) ;
2. `ANTHROPIC_API_KEY` (clé du propriétaire, côté serveur uniquement) ;
3. `RELAY_TOKEN` (secret partagé saisi une fois dans l’onglet *Agent*) ;
4. `ALLOW_ORIGIN` si le site n’est pas `https://84dr55wgm2-eng.github.io` ;
5. dans le studio : *Lieux → Agent* → adresse du relais + jeton.

Sans ces paramètres, l’onglet Agent affiche `provider_not_configured` et le prérequis manquant ; les opérations
restent utilisables depuis *Catalogue* et *Assemblage*, présentées comme des opérations, pas comme de l’IA.
