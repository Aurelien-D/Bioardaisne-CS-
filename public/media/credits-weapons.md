# Crédits — modèles 3D des armes

Les modèles réalistes des armes (`public/media/models/weapons/<id>/`) proviennent de sources
libres. Seules les licences **CC0** et **CC BY** ont été retenues (aucune licence NC, ND ou
« editorial »). Les licences ont été vérifiées le 11 novembre 2026 auprès des API de Sketchfab et de Poly Haven.

| Arme (id) | Modèle d'origine | Auteur | Source | Licence | Modifications apportées |
| --- | --- | --- | --- | --- | --- |
| Bistouri (`knife`) | « Surgical Knife » | GulzarMrRobotics (GulzarAhmed) | https://sketchfab.com/3d-models/surgical-knife-b435ebe4ea684b75b73008d497a4b082 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Maillage simplifié (167 424 → 16 500 triangles), normales recalculées, matériaux acier inoxydable, agrandi à 24 cm |
| Pipette P9 (`pistol`) | « 9mm Pistol » | Urpo | https://sketchfab.com/3d-models/9mm-pistol-30222f9a59104426ba526a6b20cd7532 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Culasse, chargeur et détente séparés du reste, textures recompressées |
| Lancette .50 (`deagle`) | « Desert Eagle » | ELIZION | https://sketchfab.com/3d-models/desert-eagle-cabde59f5cf24effaf80536e35d04e95 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Cartouche de présentation retirée, textures recompressées |
| Centri-9 (`smg`) | « KRSV VECTOR » | h1ggs | https://sketchfab.com/3d-models/krsv-vector-609166faf8e5416f957c88e0af657e09 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Textures recompressées |
| AK-Tube 47 (`rifle_ak`) | « AKMN » | Kihan_lee (dlrlgks1013) | https://sketchfab.com/3d-models/akmn-c1e6d788ecc84d33962027a40046134d | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Textures recompressées |
| M4 Sérum (`rifle_m4`) | « AR-15 style rifle » | Mateusz Woliński (jeandiz / SpatialNeglect) | https://sketchfab.com/3d-models/ar-15-style-rifle-50d33435445e439c95e3b36e9d4bd798 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Boîtier GPS de la crosse retiré ; textures de couleur éclaircies (gamma 0,8) et occlusion atténuée (le modèle d'origine est très sombre) ; fenêtre du chargeur découpée, lentilles de l'optique opaques ; normales et UV quantifiés |
| Agitateur 12 (`shotgun`) | « Remington 870 Police Magnum 12 Gauge Shotgun » | 8sianDude (haoliu95) | https://sketchfab.com/3d-models/remington-870-police-magnum-12-gauge-shotgun-eea11de7e9d24b6683962b8388c319eb | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Cartouches de présentation retirées ; pompe, culasse et détente séparées du maillage unique ; textures recompressées |
| Le Microscope (`sniper`) | « Bolt Action Rifle 7.62 » | Mateusz Sadek (Poly Haven) | https://polyhaven.com/a/bolt_action_rifle_7_62 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Cartouche de présentation retirée, lentilles de la lunette rendues opaques, textures 1k recompressées |

Tous les modèles ont en outre été replacés dans le repère du jeu (mètres, taille réelle, canon
vers −Z, dessus vers +Y, origine à la poignée), regroupés en quelques pièces nommées (corps,
culasse, chargeur, détente…) et convertis au format servi par le jeu : `model.json` (glTF 2.0,
géométrie intégrée en base64) et textures `.jpg` / `.png` à côté, 1024 px au plus.

Les modèles Sketchfab ont été récupérés au format GLB dans le jeu de données
[Objaverse](https://huggingface.co/datasets/allenai/objaverse) (textures 1024 px), qui conserve
dans chaque fichier le titre, l'auteur, la licence et l'adresse d'origine ; ces informations sont
recopiées dans le champ `asset.extras` de chaque `model.json`, et le crédit figure dans le champ
`credit` du manifeste (`src/client/render/weapons/assets.ts`).

Les noms et marques qui apparaissent dans les titres d'origine ou sur certaines textures
(marquages de fabricant gravés sur les armes) appartiennent à leurs propriétaires respectifs ;
ils ne sont cités ici que pour identifier les modèles et créditer leurs auteurs.
