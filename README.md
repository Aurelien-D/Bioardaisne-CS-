# BioArd'Aisne Strike

FPS 3D multijoueur jouable dans le navigateur, dans l'esprit de Counter-Strike: Source, aux couleurs du
laboratoire Bio Ard'Aisne. Deux équipes — l'**Équipe Labo** et **Les Auditeurs** (audit surprise !) —
s'affrontent dans des décors inspirés de nos laboratoires.

Aucune installation côté joueur : un navigateur récent sur PC (Chrome, Edge ou Firefox) suffit.

## État actuel

| Élément | État |
|---|---|
| Déplacements « Source » (ZQSD, saut, accroupi, marche silencieuse), collisions | ✅ |
| 8 armes en vrais modèles 3D tenus à deux mains : recul, dispersion, visée à l'épaule (optique transparente à réticule lumineux, organes de visée alignés), flash de bouche, fumée, douilles éjectées, culasses et chargeurs animés au rechargement | ✅ |
| Bots (4 niveaux de difficulté), jeu solo sans serveur | ✅ |
| Multijoueur : salons privés (code et lien d'invitation), serveur autoritaire, chat, tableau des scores | ✅ |
| Mode **Match à mort par équipe** en manches | ✅ |
| Carte `de_labo_charleville` (inspirée du site du cours Briand) | ✅ |
| Menus, options (souris, vidéo, audio, viseur, touches), HUD complet, audio procédural | ✅ |
| Rendu réaliste : matériaux physiques photographiés, ciel HDR, soleil bas et ombres dynamiques, reflets sur les sols (linos brillants, chaussée mouillée), rayons de soleil, occlusion ambiante, bloom, tonemapping filmique | ✅ |
| Personnages animés et une centaine de vrais modèles 3D pour le décor : paillasses, poste de sécurité, chariots, mobilier de bureau, climatiseurs, véhicules, vélos, arbres… (sous licence libre, voir plus bas) | ✅ |
| Cartes `de_rethel` et `de_charleville` | ⏳ à faire |
| Modes **Audit surprise** (désamorçage) et **Sécurisation du laboratoire** | ⏳ à faire (désactivés dans les menus ; zones et points déjà posés sur la carte) |

## Lancer le jeu en local

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install
npm run dev
```

Ouvrez ensuite <http://localhost:5173>. Cette commande lance à la fois le client (Vite, port 5173) et le
serveur de jeu (port 8080). Le mode **solo** fonctionne même sans serveur : la simulation tourne alors dans
le navigateur.

Pour tester le multijoueur sur une seule machine : ouvrez deux onglets, créez un salon dans le premier et
rejoignez-le dans le second avec le code affiché dans le menu Échap.

### Version de production

```bash
npm run build     # compile le client (dist/client) et le serveur (dist/server)
npm start         # http://localhost:8080
```

Un seul processus Node sert le jeu **et** héberge les parties (WebSocket sur `/ws`).
Variables d'environnement : `PORT` (8080 par défaut), `HOST` (0.0.0.0 par défaut).

## Commandes

Les touches sont **physiques** : sur un clavier AZERTY, on joue bien avec ZQSD. Tout est modifiable dans
*Options → Touches*.

| Action | Touche |
|---|---|
| Se déplacer | Z Q S D |
| Sauter / s'accroupir / marche silencieuse | Espace / Ctrl gauche ou C / Maj gauche |
| Tirer / viser à l'épaule (lunette pour Le Microscope) | Clic gauche / clic droit maintenu |
| Recharger | R |
| Armes | 1, 2, 3, molette, A (dernière arme) |
| Tableau des scores | Tab |
| Chat / chat d'équipe | Entrée ou Y / U |
| Choix des armes / de l'équipe | B / M (ou `,` selon le clavier) |
| Menu | Échap |

Astuce : cliquez dans le jeu pour capturer la souris. `Ctrl+W` ferme l'onglet dans tous les navigateurs —
préférez `C` pour vous accroupir en avançant, ou passez en plein écran (F11).

## Inviter des collègues

1. Menu **Créer un salon privé** → choisissez la carte, le nombre de bots, etc.
2. Dans le jeu, **Échap** affiche le **code du salon** (5 caractères) et un bouton **Copier le lien d'invitation**.
3. Vos collègues ouvrent le lien (ou saisissent le code dans **Rejoindre un salon**).

Il faut pour cela que le serveur soit joignable par tout le monde : voir ci-dessous.

## Déployer le jeu

### Sur le réseau du laboratoire (le plus simple)

Sur un PC ou un serveur du réseau interne :

```bash
npm install && npm run build && npm start
```

Les collègues ouvrent `http://<adresse-du-poste>:8080`. Le pare-feu du poste doit autoriser le port 8080.

### Avec Docker (serveur interne ou VPS)

```bash
docker build -t bioardaisne-strike .
docker run -d --name strike -p 8080:8080 --restart unless-stopped bioardaisne-strike
```

Pour une adresse publique en HTTPS, placez un reverse proxy devant (exemple avec [Caddy](https://caddyserver.com),
qui gère le certificat et les WebSockets automatiquement) :

```
strike.exemple.fr {
    reverse_proxy localhost:8080
}
```

### Sur un hébergeur (Render, Fly.io, Railway…)

Le dépôt contient un `Dockerfile` : il suffit de créer un service web à partir du dépôt.
Sans Docker, les réglages sont : commande de build `npm install && npm run build`, commande de démarrage
`npm start`, port `8080` (ou la variable `PORT` fournie par l'hébergeur). L'hébergeur doit accepter les
WebSockets (c'est le cas des trois cités).

Contrôle de bon fonctionnement : `GET /healthz` répond `ok`, `GET /api/status` donne le nombre de salons et de joueurs.

### Sur GitHub Pages (version solo uniquement)

GitHub Pages ne sait servir que des fichiers : il n'y a pas de serveur de jeu derrière, donc pas de multijoueur.
Le dépôt contient un déploiement automatique (`.github/workflows/pages.yml`) qui compile le jeu et publie la
version solo à chaque mise à jour de `main`.

Réglage à faire une seule fois dans le dépôt : **Settings → Pages → Build and deployment → Source : « GitHub Actions »**.
(Avec la source « Deploy from a branch », Pages sert le code source non compilé et la page reste blanche.)

Le jeu est ensuite disponible sur `https://<compte>.github.io/<dépôt>/`. Pour produire la même version à la main :

```bash
BAS_BASE=./ BAS_STATIC=1 npm run build:client   # dist/client, à déposer tel quel sur n'importe quel hébergeur de fichiers
```

### Dimensionnement

Le serveur est léger : un match de 12 joueurs consomme moins de 1 % d'un cœur de processeur. Les salons vides
sont supprimés au bout de deux minutes. Limites par défaut : 50 salons, 16 joueurs par salon.

## Développement

```bash
npm run typecheck   # trois projets TypeScript (simulation partagée, client, serveur et outils)
npm test            # tests unitaires et de simulation (Vitest)
```

Outils :

| Commande | Rôle |
|---|---|
| `npx tsx tools/map-check.ts <carte\|all>` | Valide une carte (apparitions, étanchéité, navigation des bots…) |
| `npx tsx tools/map-plan.ts <carte>` | Génère un plan vu de dessus (SVG et PNG) dans `tools/out/` |
| `node tools/shot.cjs --map <carte> --pose "x,y,z,lacet,tangage"` | Captures 3D d'une carte |
| `npx tsx tools/sim-bench.ts --map <carte> --bots 10 --minutes 4` | Match de bots sans affichage (équilibre, blocages, performances) |
| `node tools/e2e/solo.cjs` et `node tools/e2e/multi.cjs` | Tests de bout en bout dans un navigateur sans affichage (après `npm run build`, nécessitent Playwright) |
| `node tools/e2e/look.cjs` | Captures en vue subjective (hanche, visée, tir) |
| `npm run build:client && node tools/make-artifact.mjs <fichier.html>` | Assemble le jeu en **une seule page HTML** (solo uniquement, sans serveur) |

L'architecture est décrite dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). En résumé :

- `src/shared` — simulation commune au client et au serveur (physique, mouvement, armes, salon, bots, cartes) ;
- `src/server` — serveur Node (HTTP + WebSocket) ;
- `src/client` — rendu Three.js, audio, menus, HUD et cœur du jeu (prédiction, interpolation).

### Ajouter une carte

1. Créez `src/shared/maps/<id>.ts` qui exporte `meta` et `build()` (voir `de_labo_charleville.ts`).
   Les murs, portes, escaliers et le mobilier se posent avec `helpers.ts` et `props/`.
2. Ajoutez le module à `MAP_MODULES` dans `src/shared/maps/index.ts`.
3. Validez : `npx tsx tools/map-check.ts <id>` puis `npx tsx tools/sim-bench.ts --map <id>`.

Collisions, rendu, éclairage et navigation des bots sont dérivés automatiquement de ce fichier.

### Ajouter une arme

1. Ajoutez son identifiant et sa fiche dans `src/shared/weapons/defs.ts`.
2. Ajoutez son modèle dans `src/client/render/weapons/models.ts` (version simplifiée) et, pour un vrai modèle 3D,
   un dossier `public/media/models/weapons/<id>/` déclaré dans `src/client/render/weapons/assets.ts` ;
   ajoutez son timbre dans `src/client/audio/sounds/weapons.ts`.

## Limites connues

- Les modes à objectif et les deux cartes urbaines ne sont pas encore développés.
- Éclairage précalculé : trois contrôles de qualité ne sont pas encore atteints (raccord de lumière entre deux
  dalles de sol, soleil à travers une vitre, exposition de l'arène de test). Ils sont marqués comme défauts
  connus dans `tests/lightbake.test.ts`.
- Quelques équipements restent modélisés par le code, faute de modèles libres convaincants : grands automates, convoyeur,
  centrifugeuses, fauteuil de prélèvement, banque d'accueil et petits objets de paillasse.
- En qualité « basse », les modèles 3D d'armes et de personnages sont remplacés par leurs versions simplifiées.
- Les reflets de sol et l'occlusion ambiante n'existent qu'en qualité « élevée » (réglage par défaut). Si la machine ne
  tient pas 34 images par seconde, le jeu retire de lui-même les reflets puis baisse la résolution ; sans accélération
  graphique (rendu logiciel), ces effets sont coupés d'office. Pour un PC modeste, choisir « moyenne » ou « basse ».
- La visée à l'épaule est visuelle (zoom et alignement du viseur) : elle ne modifie pas la précision calculée par le serveur.
- Jeu pensé pour PC (clavier et souris) ; pas de version mobile.

## Marque et contenus

Les logos du dossier `public/brand/` sont ceux du Laboratoire Bio Ard'Aisne (repris du site public à la demande
du laboratoire) et lui appartiennent.

Assets tiers du dossier `public/media/` :

| Élément | Source | Licence |
|---|---|---|
| Textures photographiques (`media/tex/`) et ciel (`media/hdr/sky.jpg`, converti depuis `belfast_sunset_puresky`) | [Poly Haven](https://polyhaven.com) | CC0 (domaine public) |
| Textures photographiques d'intérieur (`media/tex/` : plafond, terrazzo, moquette, métal, bois) | [ambientCG](https://ambientcg.com) | CC0 (domaine public) |
| Personnage animé (`media/models/soldier.json`, converti depuis `Soldier.glb`) | Exemples de [three.js](https://github.com/mrdoob/three.js), personnage « Vanguard » issu de Mixamo | Conditions d'utilisation Mixamo / Adobe (usage libre dans un projet, **pas CC0**) — à remplacer si le jeu devait être diffusé publiquement |

| Armes (`media/models/weapons/`) : 7 modèles Sketchfab (via Objaverse), 1 modèle Poly Haven | Auteurs et liens dans [`public/media/credits-weapons.md`](public/media/credits-weapons.md) | CC BY 4.0 (7) et CC0 (1) |
| Mobilier, équipements de laboratoire, véhicules, arbres, mobilier urbain (`media/models/props/`, 103 modèles) | Auteurs et liens dans [`public/media/credits-props.md`](public/media/credits-props.md) | CC BY 4.0 et CC0 |

Les modèles sous **CC BY** imposent de citer leurs auteurs : les deux fichiers de crédits doivent accompagner toute
diffusion du jeu. Aucun modèle « non commercial », « sans modification » ou sans licence explicite n'est utilisé.

Le reste — mobilier de laboratoire, sons, textures secondaires — est généré par le code ; aucun élément n'est repris d'un jeu existant.
