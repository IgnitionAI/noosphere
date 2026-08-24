# F-024 — Déduplication et fusion réversible

## Résultat utilisateur

Garder un CRM propre : détecter les doublons, fusionner les contacts en
conservant toutes les sources, et pouvoir annuler la fusion sans perte.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | oui | décide des fusions |
| operator | oui | oui | décide des fusions |
| reviewer | oui | propose une fusion | non |
| viewer | oui | non | non |

## Périmètre

- détection : match certain (empreinte d’identité identique) et candidats
  probables (signaux combinés) ;
- file de revue des candidats avec comparaison champ à champ ;
- fusion : conservation de toutes les identités, emplois, provenances et
  références (campagnes, imports, signaux) ;
- annulation : restauration des deux contacts et réaffectation de leurs
  relations ;
- fusion automatique limitée aux matchs certains lors d’un import ou d’un
  enrichissement.

## Hors périmètre

- fusion d’entreprises (reportée, le besoin n’est pas mesuré) ;
- déduplication à la volée pendant la découverte (F-023 signale, ne fusionne
  pas) ;
- scoring probabiliste par modèle (AI-100).

## Parcours principal

1. le système détecte un candidat de fusion (import, enrichissement ou
   changement d’identité) ;
2. l’utilisateur ouvre la file de revue et compare les deux fiches ;
3. il fusionne (match confirmé) ou rejette (faux positif, mémorisé) ;
4. la fusion est auditée et annulable depuis l’historique ;
5. l’annulation restaure les deux contacts dans leur état antérieur.

## Règles métier et invariants

- le nom seul ne déclenche jamais ni fusion ni candidat automatique ;
- un match certain (même empreinte email ou LinkedIn) peut fusionner
  automatiquement ; tout match probable exige une décision humaine ;
- la fusion conserve toutes les sources, identités, emplois et références —
  aucune donnée n’est perdue ;
- une suppression active (F-026) survit à la fusion et s’applique au contact
  fusionné ;
- un rejet de candidat est mémorisé : la même paire n’est pas reproposée ;
- l’annulation restaure les deux contacts et réaffecte leurs relations
  d’origine ;
- fusion et annulation sont idempotentes et auditées.

## Critères d’acceptation

- Étant donné deux contacts partageant uniquement un nom, quand la détection
  tourne, alors aucun candidat automatique n’est créé ;
- Étant donné un candidat probable, quand je fusionne, alors le contact
  conservé expose les identités, emplois et provenances des deux fiches ;
- Étant donné une fusion, quand je l’annule, alors les deux contacts
  réapparaissent avec leurs relations initiales ;
- Étant donné un contact supprimé fusionné avec un contact actif, quand la
  fusion s’applique, alors le résultat reste inéligible ;
- Étant donné une paire rejetée, quand un nouvel import recrée les mêmes
  données, alors le candidat n’est pas reproposé ;
- Étant donné un reviewer, quand il appelle l’endpoint de fusion, alors la
  réponse est 403.

## États et erreurs

- loading : skeleton de la file de revue ;
- empty : aucun candidat — état neutre, pas d’action forcée ;
- validation : fusion impossible si l’un des contacts a disparu entre-temps ;
- forbidden : reviewer et viewer sans action de fusion ;
- provider indisponible : non applicable ;
- conflit métier : fusion concurrente de la même paire, annulation d’une
  fusion déjà annulée ;
- reprise : la file de revue conserve filtres et position après navigation.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/prospects` (file de revue des doublons)
et comparaison dans `/w/[workspaceSlug]/prospects/[contactId]`.

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/merge-candidates` | file de revue des candidats |
| POST | `/api/v1/merge-candidates/:id/actions/approve` | fusionner (déjà déclaré en V1) |
| POST | `/api/v1/merge-candidates/:id/actions/reject` | rejeter et mémoriser la paire |
| POST | `/api/v1/contacts/:id/actions/undo-merge` | annuler une fusion |
| GET | `/api/v1/contacts/:id/merges` | historique des fusions du contact |

**Événements sortants** : `ContactMerged`, `ContactMergeUndone`.

**Ports externes** : aucun.

## Données et confidentialité

- agrégats : `MergeCandidate`, `ContactMerge` (snapshot des deux états pour
  l’annulation) ;
- données personnelles : la fusion consolide des identités personnelles —
  le snapshot d’annulation contient les mêmes données que les fiches ;
- rétention : le snapshot est conservé tant que l’annulation reste autorisée,
  puis expiré selon la politique du workspace ;
- audit : détection, décision (qui, quand, motif), fusion et annulation
  tracées.

## Analytics

- événements `merge_candidate_created`, `contact_merged`,
  `contact_merge_undone` ;
- dimensions : workspace, origine du candidat (import, enrichissement) ;
- métrique de succès : taux de faux positifs rejetés.

## Tests obligatoires

- domaine : règles de matching (nom seul insuffisant, empreinte certaine) ;
- application : fusion conservatrice, rejet mémorisé, annulation
  restauratrice ;
- intégration PostgreSQL : réaffectation des relations à la fusion et à
  l’annulation, idempotence des deux actions ;
- suppression tardive : une suppression créée entre détection et fusion
  s’applique au contact fusionné ;
- isolation workspace : aucun candidat inter-workspaces ;
- permission : fusion refusée à reviewer/viewer par appel direct API ;
- E2E : import créant un doublon → revue → fusion → annulation.

## Dépendances

- F-003 (audit) : partiel — audit log à livrer ;
- F-021 (contacts) : fondations livrées ;
- F-022 : source principale de candidats ;
- F-026 : la suppression doit survivre à la fusion.

## Questions résolues avant développement

- la fusion d’entreprises est explicitement reportée hors Wave 1 ;
- le rejet d’une paire est définitif tant que les données n’ont pas changé ;
- l’annulation est possible tant que le snapshot est conservé ; la fenêtre
  exacte relève de la politique de rétention (F-053).
