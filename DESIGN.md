# Ignition Outbound Design System

## Direction

Interface de travail B2B dense, calme et orientée décision. La hiérarchie vient
du contraste, de la typographie et des bordures, pas d’ombres lourdes ou de
cartes décoratives.

Références fonctionnelles : MimikFlow pour la boucle prospect → conversation,
Explee pour la simplicité de configuration ICP/offre, shadcn/ui pour les
composants.

## Tokens

| Token | Valeur | Usage |
|---|---|---|
| `canvas` | `#F5F5F1` | fond de l’application |
| `surface` | `#FFFFFF` | panneaux et tableaux |
| `ink` | `#111827` | texte principal |
| `muted` | `#687386` | texte secondaire |
| `line` | `#DFE3E8` | bordures |
| `navy` | `#000E38` | navigation et actions fortes |
| `navy-soft` | `#0A192F` | hover navigation |
| `signal` | `#C8F169` | intention, sélection, action IA |
| `signal-ink` | `#24320A` | texte sur signal |
| `blue` | `#315EFB` | liens et information |
| `success` | `#15803D` | succès |
| `warning` | `#B45309` | attention |
| `danger` | `#B42318` | erreur et blocage |

## Typographie

- UI : Inter, 400/500/600/700.
- Chiffres et métadonnées techniques : JetBrains Mono, 500.
- Base : 14 px.
- Titres de page : 28–32 px, 650.

## Géométrie

- Grille d’espacement : 4 px.
- Rayon contrôles : 8 px.
- Rayon panneaux : 10 px.
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
