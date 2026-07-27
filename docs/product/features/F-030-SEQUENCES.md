# F-030 — Séquences multicanales versionnées

## Résultat utilisateur

Composer un playbook reproductible : étapes linéaires LinkedIn, email,
WhatsApp ou tâche manuelle, avec délais, fenêtres d’envoi, fallback et
templates validés, puis publier une `SequenceVersion` immuable.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Publication |
|---|---|---|---|
| owner/admin | oui | oui | oui |
| operator | oui | oui | non |
| reviewer | oui | non | non |
| viewer | oui | non | non |

## Périmètre

- séquences brouillon : nom, description, étapes ordonnées ;
- canaux : `linkedin_invite`, `linkedin_message`, `email`, `whatsapp`,
  `manual_task` ;
- par étape : délai (jours), fenêtre horaire d’envoi, template
  (sujet + corps pour email, corps sinon), variables autorisées
  (`{{firstName}}`, `{{lastName}}`, `{{companyName}}`, `{{title}}`,
  `{{icpName}}`, `{{senderName}}`) ;
- contraintes par canal : invitation LinkedIn ≤ 300 car., message LinkedIn ≤
  2 000 car., WhatsApp ≤ 1 000 car., email sujet ≤ 200 car. + corps ≤ 5 000
  car. ;
- fallback : un canal de repli par étape, jamais deux envois pour la même
  étape logique, aucune boucle ;
- validation à la publication + `SequenceVersion` immuable.

## Hors périmètre

- stratégie de message et politique de supervision transverses (F-012 :
  absorbée ici en templates par étape + contraintes par canal) ;
- enrollment et exécution (F-032, F-034) ;
- génération de contenu par modèle.

## Parcours principal

1. l’utilisateur crée une séquence brouillon et ajoute des étapes ;
2. il prévisualise chaque canal avec ses contraintes ;
3. la publication valide : chaque étape a un canal éligible ou est une tâche
   manuelle, les templates respectent les contraintes, les fallbacks sont
   sains ;
4. une `SequenceVersion` immuable est créée ; le brouillon peut évoluer vers
   une version suivante.

## Règles métier et invariants

- une séquence brouillon est modifiable et prévisualisable ;
- une publication crée une `SequenceVersion` immuable ;
- chaque étape possède au moins un canal éligible ou une tâche manuelle ;
- une séquence invalide ou non approuvée ne peut pas être activée
  (l’activation est F-031) ;
- les fallbacks n’entraînent jamais deux envois pour la même étape logique :
  un seul repli par étape, pas de boucle, le repli partage la position de
  l’étape ;
- une version publiée n’est jamais modifiée rétroactivement.

## Critères d’acceptation

- Étant donné une invitation LinkedIn de 400 caractères, quand je publie,
  alors 422 avec la contrainte violée ;
- Étant donné un email sans sujet, quand je publie, alors 422 ;
- Étant donné un fallback qui boucle, quand je publie, alors 422 ;
- Étant donné une v1 publiée, quand je modifie le brouillon et republie, alors
  la v1 reste inchangée et la v2 est créée ;
- Étant donné un operator, quand il publie, alors 403 (admin/owner requis).

## Contrats

**Routes UI** : `/w/[workspaceSlug]/sequences`,
`/w/[workspaceSlug]/sequences/[sequenceId]`

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET/POST | `/api/v1/sequences` | liste, création brouillon |
| GET/PATCH | `/api/v1/sequences/:id` | détail (étapes + versions), renommer |
| PUT | `/api/v1/sequences/:id/steps` | remplacer les étapes du brouillon |
| GET | `/api/v1/sequences/:id/versions` | versions publiées |
| POST | `/api/v1/sequences/:id/actions/publish` | publier une version |

**Événements sortants** : `SequenceCreated`, `SequenceVersionPublished`.

## Données et confidentialité

- `sequences`, `sequence_steps` (brouillon), `sequence_versions` (snapshot
  immuable) ;
- aucune donnée personnelle directe ; les templates ne doivent pas contenir
  de données prospect en clair (variables uniquement).

## Tests obligatoires

- validation des contraintes par canal (unitaire) ;
- fallback sain (unitaire) ;
- immutabilité des versions (intégration) ;
- rôles et isolation workspace (intégration) ;
- visuel 375 → 1440.

## Dépendances

- F-026 (suppressions, appliquées à l’enrollment F-032) ;
- D-001 (canaux d’envoi Unipile).
