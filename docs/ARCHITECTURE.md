# BioArd'Aisne Strike — Architecture technique

FPS 3D multijoueur sur navigateur, dans l'esprit de Counter-Strike: Source, aux couleurs du
laboratoire BioArd'Aisne. Ce document est la **référence commune** : il décrit l'organisation du
code, les contrats entre modules et le comportement attendu de chacun.

## 1. Principes

| Choix | Raison |
|---|---|
| **TypeScript partout**, un seul paquet npm | Le même code de simulation tourne dans le navigateur et sur le serveur. |
| **Three.js** (rendu), **Vite** (client), **Node + ws** (serveur) | Stack légère, aucun plugin, aucune installation côté joueur. |
| **Simulation partagée** (`src/shared`) | Mouvement, armes, collisions : mêmes fonctions pour la prédiction client, l'autorité serveur et les bots. |
| **Serveur autoritaire** | Dégâts, éliminations, scores et manches sont décidés par la `Room`. Le client prédit seulement son propre joueur. |
| **Solo = serveur local** | En solo, la même `Room` tourne dans le navigateur via une connexion « loopback ». Aucun code de jeu dupliqué. |
| **Physique maison** : hull AABB balayé contre des boîtes alignées | Déterministe, rapide, identique client/serveur ; sensations « Source » (accélération, friction, air-strafe). |
| **Cartes = code** (`MapBuilder`) | Une carte est un fichier TypeScript ; collisions, rendu, navigation des bots et éclairage en sont dérivés automatiquement. |
| **Tout est procédural** | Textures, modèles, sons : générés par le code (aucun asset sous licence). |

Conventions : Y vers le haut, mètres, secondes, radians. `yaw = 0` regarde vers −Z, yaw positif = rotation à
gauche ; `pitch > 0` regarde vers le haut (voir `src/shared/math/vec3.ts`).

## 2. Arborescence

```
src/shared/            Code commun client + serveur (AUCUNE API DOM ni Node)
  constants.ts         Constantes de gameplay (tick, hull, mouvement, boutons…)
  identity.ts          Équipes, couleurs, noms de bots, répliques de l'annonceur
  types.ts             PlayerState, UserCmd, RoomConfig, MatchState…
  protocol.ts          Messages réseau + interface Connection
  math/                vec3, rng déterministe
  physics/world.ts     CollisionWorld (balayage AABB, lancer de rayon)
  player/movement.ts   stepMovement
  player/step.ts       stepPlayer = mouvement + armes (point d'entrée unique)
  weapons/defs.ts      Données des armes        weapons/logic.ts  Machine à états des armes
  maps/                Format de carte, MapBuilder, helpers, props, cartes, registre
  nav/navgrid.ts       Grille de navigation + A*
  bots/                IA des bots
  sim/                 Room (simulation autoritaire), combat, modes de jeu
src/server/            Serveur Node : HTTP statique + WebSocket + gestion des salons
src/client/
  core/                settings.ts (options persistantes), contracts.ts (interfaces des sous-systèmes)
  net/                 Connexions WebSocket et loopback
  game/                Cœur du jeu : boucle, prédiction, interpolation, entrées, orchestration
  render/              engine, monde, textures, ciel, viewmodel, avatars, effets
  audio/               Moteur audio procédural (WebAudio)
  ui/                  Menus et HUD (DOM + CSS)
  dev/                 Pages de développement (visionneuse de carte, bancs d'essai)
dev/*.html             Pages de dev servies par Vite (non incluses dans le build de production)
tests/                 Tests Vitest (physique, armes, simulation, navigation, cartes…)
tools/                 Outils en ligne de commande (validation de carte, plan, captures)
docs/                  Documentation
```

## 3. Règles de contribution (humains et agents)

- **Ne pas modifier** `package.json`, les `tsconfig*.json`, `vite.config.ts` ni les fichiers de contrat
  (signatures exportées) sans nécessité absolue ; signaler tout besoin dans le compte rendu.
- `src/shared` doit compiler **sans DOM ni Node** (`npx tsc -p tsconfig.shared.json`). Pas de `Date.now()`,
  `performance`, `setTimeout`, `Math.random()` dans la simulation : le temps et l'aléa sont injectés.
- Imports relatifs sans extension. Pas de dépendance npm supplémentaire (three, ws uniquement).
- Vérifications : `npm run typecheck`, `npm test`. Chaque module livre ses tests dans `tests/`.
- Identifiants et commentaires de code en anglais ; **tous les textes visibles par le joueur en français**.
- Humour : bon enfant, autour du quotidien du labo (prélèvements, tubes, automates, audits qualité).
  Pas de noms de personnes réelles ni de marques d'automates ou de logiciels.
- Les sous-systèmes client ne s'importent pas entre eux : ils dépendent de `core/contracts.ts`, de
  `core/settings.ts` et de `src/shared` uniquement. Le cœur (`src/client/game`) les assemble.

## 4. Physique — `CollisionWorld` (`src/shared/physics/world.ts`)

Monde statique composé de `Solid` (AABB) issus de la carte. Broadphase : grille uniforme 3D (ou 2D XZ)
de cellules ~2 m contenant les indices des solides ; les requêtes ne testent que les cellules traversées.

- `sweepBox(center, half, delta, mask)` : balayage AABB contre AABB (somme de Minkowski + test du segment,
  « slab method »). Retourne la fraction parcourable, la normale (axe) du premier contact, l'indice du solide.
  Recule d'un epsilon (≈ 1 mm) pour ne jamais finir en contact pénétrant. `startSolid` si chevauchement initial.
- `boxOverlaps`, `raycast` (rayon/AABB par slabs, plus proche impact, normale de la face), `lineOfSight`,
  `groundBelow`.
- Masques : `MASK.Player` ignore les solides `noPlayers` ; `MASK.Bullet` ignore `noBullets`.
- Performance cible : ≥ 1 million de `raycast`/s et ≥ 300 000 `sweepBox`/s sur une carte de 3 000 solides.
- Robustesse : aucun `NaN`, deltas nuls gérés, boîtes dégénérées ignorées.

## 5. Mouvement — `stepMovement` (`src/shared/player/movement.ts`)

Un appel = un tick (`TICK_DT`). Modèle « Source » (constantes dans `MOVE`) :

1. **Accroupi** : `s.crouch` tend vers 1 (touche) ou 0 en `CROUCH_TIME`. La hauteur du hull est interpolée
   (`hullHeight`). Se relever n'est autorisé que si le hull agrandi ne chevauche rien (`boxOverlaps`).
2. **Direction voulue** : à partir de `yaw` et des boutons ; vitesse voulue = `maxSpeed` × `walkMul` (marche
   silencieuse) × interpolation vers `crouchMul` × `s.landSlow`.
3. **Sol** : au sol si un balayage de 3 cm vers le bas touche une face de normale Y > 0,7 et `vel.y ≤ 0`.
4. **Saut** : sur front montant de `BTN.Jump` au sol → `vel.y = jumpSpeed`, `ev.jumped`.
5. **Au sol** : friction (`friction`, `stopSpeed`) puis accélération `accel` (formule Quake/Source :
   `addspeed = wish − dot(vel, wishdir)`, `accelspeed = min(accel·dt·wish, addspeed)`).
   **En l'air** : gravité, accélération aérienne `airAccel` avec vitesse voulue plafonnée à `airMaxWishSpeed`.
6. **Déplacement** : `slideMove` (jusqu'à 4 itérations : balayer, avancer, retirer la composante de vitesse
   le long de la normale). Au sol, `stepSlideMove` : comparer le déplacement direct avec « monter de
   `STEP_HEIGHT`, glisser, redescendre » et garder celui qui va le plus loin (montée d'escaliers) ;
   après un déplacement au sol sans saut, recoller au sol si une surface se trouve à moins de `STEP_HEIGHT`
   en dessous (descente d'escaliers sans rebond).
7. **Atterrissage** : `ev.landedSpeed` = vitesse verticale d'impact ; au-delà de 4 m/s `s.landSlow = landingSlow`,
   qui remonte vers 1 (≈ 1,5/s).
8. **Sécurité** : si le joueur démarre dans un solide, tentative de dégagement vers le haut ; jamais de `NaN`.

Exigences : déterminisme strict, pas d'accrochage aux jointures entre boîtes adjacentes (murs et sols
composés de plusieurs boîtes), impossible de traverser un mur même à grande vitesse, arrêt net,
déplacements réactifs. Portes ≥ 1,0 m franchissables, passage accroupi sous 1,4 m.

## 6. Armes — `src/shared/weapons/logic.ts`

Données dans `weapons/defs.ts`. `stepWeapons(s, cmd, ev)` par tick :

- Timers : `fireCd`, `draw`, `reload` décroissent de `TICK_DT` ; `sinceShot` augmente (plafonné à 10).
- **Changement d'arme** (`cmd.slot` valide, différent, emplacement non vide) : `active = slot`,
  `draw = drawTime`, annule rechargement et zoom, `shots = 0`, `ev.switched`.
- **Rechargement** : `BTN.Reload` (ou chargeur vide avec réserve, automatiquement) si pas déjà en cours,
  `draw == 0`, chargeur incomplet et réserve > 0 → `reload = reloadTime`, zoom annulé, `ev.reloadStarted`.
  À la fin : transfert réserve → chargeur, `ev.reloadFinished`.
- **Zoom** (armes avec `zoomFov`) : front montant de `BTN.AltFire` → niveau 0 → 1 → 2 → 0, `ev.zoomChanged`.
- **Tir** : `BTN.Fire` (maintenu si `auto`, front montant sinon) quand `draw == 0`, `reload == 0`, `fireCd == 0`,
  non `frozen`, `action == 0`.
  - Corps à corps : un « tir » de portée `range` dans l'axe du regard.
  - Arme à feu, chargeur > 0 : `clip--` ; direction de visée = angles de vue + `punch` ; pour chaque plomb,
    déviation aléatoire uniforme dans le cône `currentSpread(s)` avec `mulberry32(shotSeed(cmd.seq, arme))`
    (même graine côté client et serveur) ; `ev.fired = { weapon, origin: œil, dirs }`.
  - Recul : `punchPitch += recoilUp × k` (k réduit quand on approche de `recoilMax`),
    `punchYaw += recoilSide × sin(0,62·i + 0,9) × min(1, i/3) + recoilJitter × aléa` (i = `floor(shots)`),
    puis `shots += 1`, `spread = min(spreadShotMax, spread + spreadShot)`, `fireCd = fireInterval`,
    `sinceShot = 0`, `protect = 0`.
  - Chargeur vide : `ev.dryFire` sur front montant.
- **Récupération** (chaque tick) : `punch *= exp(−recoilRecovery·dt)`, `spread *= exp(−spreadRecovery·dt)` ;
  si `sinceShot > shotsResetDelay`, `shots` décroît (≈ 12/s) jusqu'à 0.
- `currentSpread(s)` : base (`zoomSpread` si zoomé, sinon `spread`) × bonus accroupi au sol
  + `spreadMove × f` où `f = clamp((vitesse/vitesseMax − 0,34)/0,66, 0, 1)` (précis en marchant ou accroupi,
  imprécis en courant : il faut s'arrêter pour tirer juste) + `spreadAir` en l'air + `s.spread`.

## 7. Simulation — `Room` (`src/shared/sim/`)

La `Room` possède le monde (`getMap` → `CollisionWorld` → `NavGrid`), les joueurs (humains et bots), le mode
de jeu et l'état du match. API publique figée dans `sim/room.ts` ; le reste (`sim/combat.ts`, `sim/modes/*.ts`,
etc.) est interne.

**Boucle `tick()`** (64 Hz) :
1. Humains : traiter les `UserCmd` en file (1 par tick, 2 si la file dépasse 3 ; file plafonnée à
   `LIMITS.maxCmdBacklog`, commandes invalides ou trop anciennes ignorées). Bots : `bot.think()` → commande.
2. Chaque commande passe par `stepPlayer`. Événements : `fired` → `resolveShot` ; `landedSpeed` → dégâts de chute.
3. Historique de positions (≈ 1 s) par joueur pour la compensation de lag.
4. Logique du mode (objectifs, fin de manche), réapparitions, phases.
5. Toutes les `SNAPSHOT_EVERY` ticks : `S_Snapshot` par humain (état complet du destinataire, tuples compacts
   des autres joueurs vivants, événements depuis le dernier snapshot). `S_Roster` / `S_Match` quand ils changent.

**Tirs (`resolveShot`)** — autorité serveur + compensation de lag : les autres joueurs sont replacés à leur
position au temps `cmd.st` (borné à `MAX_LAG_COMP_MS`, interpolé dans l'historique) ; chaque plomb est un rayon
testé contre le monde (`raycast`) puis contre les hitboxes (AABB tête / torse / ventre / jambes dérivées de la
position et de `crouch`). Dégâts = `damage × multiplicateur de zone (tête : headMul) × falloff^(distance/10)`.
Armure : `santé −= dégâts × armorPen`, `armure −= (dégâts − part santé) / 2`. Pas de tir allié sauf
`friendlyFire`. Protection de réapparition : invulnérable tant que `protect > 0`. Couteau : rayon court,
bonus dans le dos.

**Événements** : `shot` (à tous sauf le tireur), `hit` (au tireur), `hurt` (à la victime), `kill` (à tous),
`announce` (premier sang, doublés…), `obj` (objectifs).

**Phases** : `freeze` (joueurs figés `frozen`) → `live` → `post` (5 s, annonce du vainqueur) → manche suivante…
→ `over` (10 s) → nouveau match. Un joueur qui rejoint en cours reçoit `S_Welcome` avec l'état complet et est
affecté automatiquement à l'équipe la moins nombreuse.

**Mode TDM** : réapparition après `respawnDelay`, au point d'apparition de l'équipe le plus éloigné des ennemis,
protection 2 s. La manche se termine à `killLimit` ou à la fin du temps (plus d'éliminations = victoire ;
égalité = manche nulle). Match gagné à `roundsToWin` manches.

**Modes à objectif** (interface `GameMode` interne : `onRoundStart`, `onTick`, `onPlayerKilled`, `onUse`,
`checkRoundEnd`, `objective()`, `botGoals()`) :
- *Désamorçage / « Audit surprise »* : un Auditeur porte le dossier d'écart critique ; pose (3 s, `BTN.Use`
  dans une zone `site`) ; délai 40 s ; le Labo lève l'écart (6 s). Pas de réapparition.
- *Sécurisation* : glacières (`points` de type `sample`) ; un Auditeur en prend une en la touchant, la porte
  jusqu'à une zone `extract` ; lâchée à sa mort ; un défenseur la sécurise en restant dessus 3 s (`BTN.Use`).
  Les Auditeurs gagnent en extrayant `needed` glacières, le Labo en tenant jusqu'à la fin du temps ou en
  éliminant tous les attaquants.

**Bots** : `botFill` = nombre total de joueurs visé ; la Room ajoute/retire des bots pour équilibrer les équipes.

**Robustesse** : `handleMessage` ne lève jamais d'exception ; noms et messages nettoyés et bornés ; chat limité
en débit ; seul l'hôte peut modifier la configuration ; migration d'hôte au départ de l'hôte.

## 8. Navigation — `NavGrid` (`src/shared/nav/navgrid.ts`)

Grille générée depuis le `CollisionWorld` (cellules de 0,5 m) : pour chaque colonne, les sommets de solides où
un hull debout tient sont des nœuds « marchables » (plusieurs niveaux possibles). Arêtes vers les 8 voisins si
le dénivelé ≤ `STEP_HEIGHT` (bidirectionnel) ou chute ≤ 2,5 m (sens unique), validées par balayage du hull.
Composantes connexes calculées (îlots minuscules ignorés). `findPath` : A* (tas binaire) + lissage ;
`nearest`, `reachable`, `randomPoint`, `randomPointNear`, `walkable`. Construction < 1,5 s pour 100 × 100 m.

## 9. Bots — `src/shared/bots/`

`think()` produit un `UserCmd` par tick : perception (champ de vision ~110°, ligne de vue, bruit des tirs via
`onSound`, dégâts via `onHurt`), temps de réaction et erreur de visée selon la difficulté, visée lissée avec
vitesse angulaire limitée, tir en rafales avec compensation partielle du recul, mitraillage latéral en combat,
rechargement à couvert, changement d'arme si chargeur vide, suivi de chemin (`NavGrid`), détection de blocage
(saut / nouveau chemin), objectifs fournis par `env.goals()`. Déterministe (graine).

| Difficulté | Réaction | Erreur de visée | Vise la tête |
|---|---|---|---|
| 0 Facile | ~600 ms | ~4° | jamais |
| 1 Normal | ~380 ms | ~2,5° | rarement |
| 2 Difficile | ~250 ms | ~1,5° | souvent |
| 3 Expert | ~160 ms | ~0,8° | très souvent |

## 10. Client — cœur du jeu (`src/client/game/`)

- **Boucle** : `requestAnimationFrame`. Simulation locale à pas fixe 64 Hz (accumulateur, 5 pas max par image) :
  chaque pas échantillonne les entrées → `UserCmd` → `stepPlayer` (prédiction) → envoi au serveur.
  La souris modifie les angles de vue à chaque image (aucune latence de visée).
- **Réconciliation** : à chaque snapshot, repartir de l'état autoritaire `you`, rejouer les commandes non
  acquittées (`seq > ack`) ; l'écart de position est absorbé par un décalage visuel qui s'estompe (~100 ms).
  Les effets (son, flash, traceurs) ne sont déclenchés qu'à la première simulation d'une commande.
- **Interpolation** des autres joueurs : tampon de snapshots, rendu à `tempsServeur − INTERP_DELAY_MS`.
  Horloge serveur estimée par `ping`/`pong`. `cmd.st` = temps de rendu des entités distantes.
- **Caméra** : position interpolée entre deux ticks, lissage des marches d'escalier, recul visuel (`punch`),
  FOV de zoom, léger affaissement à l'atterrissage.
- **Orchestration** : menus ↔ chargement de carte ↔ partie ; relie `Connection`, moteur de rendu, viewmodel,
  avatars, effets, audio, HUD selon `core/contracts.ts`.
- **Debug / tests automatisés** : avec `?debug=1`, `window.__bas` expose l'état (position, santé, munitions,
  joueurs visibles…) et des actions (orienter la vue, simuler des touches) pour les tests Playwright.

## 11. Rendu (`src/client/render/`)

- **Monde** : les `boxes` sont fusionnées par matériau (peu de draw calls) avec UV planaires en espace monde
  (les textures se raccordent d'une boîte à l'autre) ; les `prims` fusionnées par matériau ; teintes par
  couleurs de sommets ; `signs` = quads à texture canvas ; matériaux transparents et émissifs à part.
- **Textures** : générées par canvas 2D pour chaque `MaterialId` (`maps/materials.ts`), mipmaps + anisotropie.
- **Éclairage** : précalculé (« baked ») au chargement — lightmap par face de boîte (≈ 4 texels/m) et couleurs
  de sommets pour les `prims`, à partir des `lights`, du soleil et de l'ambiance de la carte, avec ombres par
  lancer de rayons. Le monde utilise des matériaux non éclairés (texture × lightmap) : rendu très rapide et
  ambiance « Source ». Les objets dynamiques (avatars, arme) sont éclairés par une lumière hémisphérique +
  directionnelle, modulée par `engine.sampleLight(pos)`.
- **Ciel** : dôme dégradé + soleil + nuages procéduraux ; brouillard.
- **Viewmodel** : scène superposée (`viewScene`), FOV fixe, armes et bras procéduraux (gants nitrile bleus).
- **Avatars** : humanoïdes procéduraux animés (course, accroupi, visée, mort), tenue selon l'équipe.
- **Effets** : traceurs, étincelles/poussière, impacts (décals), sang, flashs, marqueurs d'objectif.

## 12. Audio (`src/client/audio/`)

100 % procédural (WebAudio) : tirs par catégorie d'arme, rechargements, pas par surface, impacts, retours de
touche, interface, annonces (jingle + synthèse vocale du navigateur en français), ambiances, musique de menu.
Spatialisation (PannerNode HRTF), atténuation et filtrage avec la distance.

## 13. Interface (`src/client/ui/`)

DOM + CSS au-dessus du canvas. **Menus** : accueil BioArd'Aisne Strike, solo, création/rejoindre un salon,
options (souris, vidéo, audio, viseur, touches), pause (code et lien du salon), choix d'équipe, choix des armes.
**HUD** : viseur dynamique, vie/armure, munitions, chrono et score, fil des éliminations, radar, chat,
tableau des scores, annonces, indicateurs de dégâts, lunette, barre d'action.

## 14. Serveur (`src/server/`)

Un seul processus Node : sert le client compilé (`dist/client`) et accepte les WebSockets sur `/ws`.
Gestion des salons privés (code à 5 caractères, lien `?room=CODE`), boucle de ticks à 64 Hz avec rattrapage,
suppression des salons vides, limites (taille et débit des messages, nombre de salons), `/healthz`.
Variables : `PORT` (8080), `HOST`.

## 15. Cartes (`src/shared/maps/`)

Une carte = un module exportant `meta` et `build()` (voir `dev_test.ts`), enregistré dans `maps/index.ts`.
Repères de conception :

| Élément | Valeur |
|---|---|
| Hull joueur | 0,7 × 0,7 × 1,8 m (1,3 m accroupi), œil à 1,64 m |
| Marche franchissable sans saut | ≤ 0,5 m (escaliers : marches de 0,2–0,25 m de haut, ≥ 0,3 m de profondeur) |
| Saut | ≈ 1,2 m (on monte sur une paillasse de 0,9 m, pas sur une armoire de 2 m) |
| Portes | largeur ≥ 1,2 m (double : 1,8–2,4 m), hauteur 2,1–2,4 m |
| Couloirs | largeur ≥ 2 m (2,5–3 m conseillé) ; plafond intérieur 2,8–3,2 m |
| Murs | épaisseur ≥ 0,2 m ; sols ≥ 0,2 m d'épaisseur |
| Couvert | bas 0,9–1,1 m (accroupi), haut ≥ 1,9 m |
| Apparitions | ≥ 8 par équipe, espacées de ≥ 1,2 m, dans des zones séparées et protégées des lignes de tir adverses |

Chaque carte doit proposer au moins trois itinéraires entre les deux camps, des lignes de vue variées
(courtes, moyennes, une longue), des couverts, pas de cul-de-sac inutile, et être fermée (impossible de sortir).
Validation : `npx tsx tools/map-check.ts <id>` ; plan : `npx tsx tools/map-plan.ts <id>` ; captures 3D :
`node tools/shot.mjs`.

## 16. Tests et outils

- `npm test` : tests unitaires et de simulation (Vitest, Node).
- `npm run typecheck` : trois projets TypeScript (shared sans DOM, client, serveur/outils).
- Tests de bout en bout (Playwright) : `tools/e2e/*.mjs` — solo et multijoueur à deux navigateurs.
