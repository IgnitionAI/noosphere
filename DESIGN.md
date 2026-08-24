# Noosphere Design System

## Direction

Noosphere est une intelligence opérationnelle calme qui transforme des signaux
en conversations et des conversations en rendez-vous. L’interface reste simple
et orientée résultat. Sa personnalité vient de la précision typographique, des
tracés de signal et du contraste, jamais d’une décoration sci-fi envahissante.

Le clin d’œil au Mechanicus reste abstrait : connaissance machine, rails de
données, nœuds et phosphore. Aucun crâne, rouage gothique ou habillage gaming.

Références fonctionnelles : MimikFlow pour la boucle prospect → conversation,
Explee pour la simplicité de configuration ICP/offre, shadcn/ui pour les
composants.

## Tokens

| Token | Valeur | Usage |
|---|---|---|
| `canvas-light` | `#F4F3ED` | fond ivoire du thème clair |
| `canvas-dark` | `#050A1C` | fond profond du thème sombre |
| `surface` | `#FFFFFF` | panneaux et tableaux |
| `surface-dark` | `#0B1430` | panneaux du thème sombre |
| `ink` | `#121A2C` | texte principal clair |
| `ink-dark` | `#EDF2FF` | texte principal sombre |
| `muted` | `#627087` | texte secondaire clair |
| `muted-dark` | `#9EABC5` | texte secondaire sombre |
| `line` | `#D9DEE8` | bordures claires |
| `line-dark` | `#202C4D` | bordures sombres |
| `navy` | `#050F2F` | navigation et identité |
| `navy-soft` | `#0E1A3B` | surface navigation secondaire |
| `signal` | `#C8F169` | intention, sélection, action IA |
| `signal-ink` | `#172307` | texte sur signal |
| `outbound` | `#4E6BFF` | activation et prospection |
| `inbound` | `#57D9CE` | contenu et demande entrante |
| `success` | `#15803D` | succès |
| `warning` | `#B45309` | attention |
| `danger` | `#B42318` | erreur et blocage |

## Typographie

- Marque et titres : Space Grotesk Variable, 500/600/700.
- UI : Geist Variable, 400/500/600/700.
- Chiffres et métadonnées techniques : IBM Plex Mono, 500/600.
- Base : 14 px.
- Titres de page : 28–32 px, 650.

## Géométrie

- Grille d’espacement : 4 px.
- Rayon contrôles : 8 px.
- Rayon panneaux : 8–10 px.
- Hauteur contrôle : 36 px.
- Sidebar desktop : 248 px.
- Topbar : 64 px.
- Largeur contenu : fluide, maximum 1680 px.

## Règles

- Une seule action primaire visible par zone.
- Les données importantes restent textuelles, jamais couleur seule.
- Les tableaux sont la structure principale des listes.
- Les panneaux latéraux servent aux détails sans perdre le contexte.
- Les vues doivent fonctionner à 375, 768, 1024 et 1440 px.
- Aucune donnée factice générique. Les exemples reflètent l’ICP IgnitionAI.
- Clair, sombre et système sont des modes de premier rang, persistés par utilisateur.
- Le thème est appliqué avant hydratation afin d’éviter tout flash clair.
- Inbound et Outbound sont distingués par leurs accents, pas par deux interfaces.
- Le motif de signal est réservé aux héros, chargements et processus réellement actifs.
- Les animations durent 120–220 ms et respectent `prefers-reduced-motion`.

## Marque

Le symbole Noosphere est un `N` construit par deux rails et trois nœuds. Il
exprime un signal qui traverse un système, sans reprendre d’iconographie tierce.
La signature produit est :

> Créer la demande. Capter les signaux. Remplir l’agenda.
