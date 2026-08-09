# AI-140 — Évaluation continue

## Résultat utilisateur

Garantir que chaque capacité IA (recherche ICP, génération de messages,
Setter) reste mesurée et fiable dans le temps : un changement de modèle ou
de prompt n’est adopté qu’après passage d’un jeu d’évaluation de référence,
avec coût, latence et qualité comparés — et aucune optimisation n’est jamais
appliquée automatiquement à une campagne active.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui (résultats, coûts, comparaisons) | crée un jeu d’évaluation, lance un run, arbitre un changement de modèle | adopte ou rejette une recommandation |
| operator | résultats des runs | non | non |
| reviewer/viewer | non (console technique) | non | non |

## État d’implémentation

Non commencé en tant que feature. Fondations vérifiées dans le code :
`ai_runs` (purpose, provider, model, **`prompt_version`**, `input_hash`,
parameters, output, status, **cost**, **latency_ms**) et `ai_tool_runs` —
chaque appel IA est déjà tracé, coûté et versionné par prompt ; scripts
d’évaluation ponctuels (`evaluate-ignitionrag-icp-run.ts`, inspection SQL
directe d’un run ICP) ; `AI_BOUNDARY.md` documente la frontière IA.
Restent à livrer : jeux d’évaluation persistés, harness d’exécution en job,
métriques de qualité (exactitude de qualification, hallucinations, respect
des claims F-050, qualité message/CTA), comparaison de modèles, mode shadow
avant changement de modèle, gouvernance des versions de prompts et boucle de
feedback.

## Périmètre

- jeux d’évaluation par capacité : conversations de référence (Setter),
  briefs ICP de référence (recherche), contextes de génération (messages) —
  chaque cas porte l’entrée, la sortie attendue ou les critères, et la
  version ;
- exécution d’un run d’évaluation en job (F-003) : rejoue le jeu contre une
  configuration (modèle + version de prompt) et produit des scores
  déterministes quand c’est possible, notés par grille sinon ;
- métriques : exactitude de qualification, taux d’hallucination (affirmation
  sans source F-050), respect des claims autorisés, qualité message/CTA,
  coût et latence (lus de `ai_runs`) ;
- comparaison : même jeu, deux configurations — tableau de bord de
  comparaison (modèles Kimi entre eux, ou versions de prompt) ;
- mode shadow : une nouvelle configuration tourne en parallèle de la
  production **sans émettre** — ses sorties sont enregistrées et évaluées,
  jamais envoyées ;
- versionnage des prompts : chaque prompt modifié produit une nouvelle
  version immuable ; la version active par capacité est explicite et son
  changement est audité ;
- recommandations de campagne (optimisations proposées) : affichées,
  jamais appliquées automatiquement (invariant catalogue) — adoption
  humaine via F-033 ;
- feedback : l’opérateur note une sortie IA (pouce + motif) ; le feedback
  alimente les jeux d’évaluation.

## Hors périmètre

- fine-tuning ou entraînement de modèles ;
- optimisation automatique appliquée aux campagnes (jamais — décision
  catalogue) ;
- benchmark de fournisseurs hors modèles Kimi configurés pour le workspace ;
- évaluation continue en production sur chaque message (l’évaluation est par
  runs sur jeux de référence, pas un filtre en ligne).

## Parcours principal

1. l’owner constitue un jeu de référence (cas réels anonymisés ou
   synthétiques, sorties attendues) ;
2. avant un changement de modèle ou de prompt, il lance le jeu sur la
   configuration candidate — en mode shadow si la capacité est en
   production ;
3. le run produit scores, coût et latence ; la comparaison avec la
   configuration active est affichée ;
4. l’owner adopte (nouvelle version active, auditée) ou rejette ;
5. en continu, les feedbacks opérateurs enrichissent les jeux ; une
   régression sur une capacité est détectée au run suivant.

## Règles métier et invariants

- aucune optimisation n’est appliquée automatiquement à une campagne active :
  toute adoption de configuration est une décision humaine auditée ;
- le mode shadow n’émet jamais : aucune action, aucun message, aucun effet
  métier — seulement des `ai_runs` marqués `shadow` ;
- une version de prompt est immuable : modifier un prompt crée une nouvelle
  version ; les `ai_runs` référencent la version exacte utilisée ;
- les métriques déterministes (coût, latence, exactitude sur cas à réponse
  unique) sont calculées par le harness, jamais estimées par le modèle
  évalué ;
- les cas d’évaluation ne contiennent pas de données personnelles réelles :
  cas anonymisés ou synthétiques uniquement (contrôle au dépôt) ;
- un run d’évaluation est idempotent (`requestKey`) et rejouable à
  l’identique sur la même configuration ;
- isolation workspace stricte : jeux, runs, feedbacks et configurations
  sont par workspace ;
- l’évaluation d’hallucination s’appuie sur les sources F-050 : une
  affirmation hors claims validés est comptée comme hallucination.

## Critères d’acceptation

- Étant donné un jeu de référence, quand je lance un run sur deux
  configurations, alors la comparaison affiche scores, coût et latence de
  chacune sur les mêmes cas ;
- Étant donné une configuration en mode shadow, quand la capacité tourne en
  production, alors les sorties shadow sont enregistrées et évaluées sans
  aucun message envoyé ;
- Étant donné un prompt modifié, quand il est sauvegardé, alors une nouvelle
  version est créée et l’ancienne reste référencée par ses `ai_runs` ;
- Étant donné une recommandation d’optimisation, quand aucun humain ne
  l’adopte, alors la campagne active est strictement inchangée ;
- Étant donné une sortie IA affirmant un fait hors claims validés, quand le
  run d’évaluation la note, alors elle est comptée comme hallucination ;
- Étant donné un cas contenant une donnée personnelle réelle, quand on le
  dépose dans un jeu, alors le dépôt est refusé (422) ;
- Étant donné le même run relancé deux fois avec la même clé, quand le
  doublon arrive, alors un seul run existe ;
- Étant donné un operator, quand il tente d’adopter une configuration,
  alors la réponse est 403 ;
- Étant donné deux workspaces, quand l’un évalue, alors l’autre ne voit ni
  jeux ni résultats.

## États et erreurs

- loading : progression du run (cas traités / total) ;
- empty : aucun jeu d’évaluation — action principale « créer un jeu » avec
  gabarits par capacité ;
- validation : cas sans critère ni sortie attendue, cas contenant des PII
  (422) ;
- forbidden : gestion des jeux, runs et adoptions réservés owner/admin,
  même par appel direct API ;
- provider indisponible : modèle injoignable → cas en échec distingué d’un
  mauvais score, retry borné, le run se termine en `partial` ;
- conflit métier : 409 sur adoption d’une configuration déjà active ;
- reprise : run `failed`/`partial` relançable sur les seuls cas en échec,
  idempotence par `requestKey`.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/ai-studio` (console d’évaluation :
jeux, runs, comparaisons, versions de prompts, feedback).

**Use cases** : `CreateEvaluationDataset`, `RunEvaluation`,
`CompareConfigurations`, `PromoteConfiguration`, `RecordAiFeedback`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET/POST | `/api/v1/evaluation-datasets` | jeux de référence par capacité | à spécifier |
| POST | `/api/v1/evaluation-runs` | lance un run (config cible, `requestKey`) | à spécifier |
| GET | `/api/v1/evaluation-runs/:id` | résultats et progression | à spécifier |
| GET | `/api/v1/evaluation-runs/compare` | comparaison de deux runs | à spécifier |
| GET | `/api/v1/ai-configurations` | versions de prompts et modèle actif par capacité | à spécifier |
| POST | `/api/v1/ai-configurations/:id/actions/promote` | adoption (owner/admin, auditée) | à spécifier |
| POST | `/api/v1/ai-runs/:id/feedback` | feedback opérateur sur une sortie | à spécifier |

**Événements sortants** : `EvaluationRunCompleted`,
`AiConfigurationPromoted` — un seul envoi par transition.

**Ports externes** : appels modèles via la couche existante (`ai_runs`,
Kimi) — aucun nouveau port fournisseur.

## Données et confidentialité

- nouvelles tables : `evaluation_datasets` + `evaluation_cases` (capacité,
  entrée, critères/sortie attendue, version), `evaluation_runs` +
  `evaluation_case_results` (configuration, scores, coût, latence, statut),
  `ai_configurations` (capacité, modèle, version de prompt, statut
  actif/shadow), `ai_feedbacks` (run, note, motif, auteur) ;
- données personnelles : interdites dans les jeux (contrôle au dépôt) ; les
  feedbacks référencent des `ai_runs` sans copier le contenu des messages ;
- rétention : runs et résultats conservés (historique de comparaison) ; la
  purge relève de F-053 ;
- audit : création de jeu, lancement de run, promotion de configuration.

## Analytics

- événements `evaluation_run_started/completed`,
  `ai_configuration_promoted`, `ai_feedback_recorded` ;
- dimensions : workspace, capacité, modèle, version de prompt ;
- métriques de succès : part des changements de configuration précédés d’un
  run d’évaluation (cible : 100 %), régressions détectées avant production,
  coût/latence par capacité suivi dans F-051.

## Tests obligatoires

- domaine : scoring déterministe, immutabilité des versions de prompt,
  règle hallucination = hors claims validés ;
- application : idempotence de run, reprise partielle sur cas en échec ;
- intégration PostgreSQL : unicité de configuration active par capacité,
  comparaison reproductible ;
- mode shadow : aucune émission — test transverse « double livraison »
  adapté (shadow + production sur le même événement, un seul envoi réel) ;
- isolation workspace et permissions (adoption refusée aux rôles non
  autorisés par appel direct) ;
- PII : rejet d’un cas contenant des données personnelles réelles ;
- E2E : jeu créé → run sur config candidate (shadow) → comparaison →
  promotion auditée → nouvelle version active référencée par les `ai_runs`
  suivants.

## Dépendances

- F-003 (jobs, audit, outbox) : livré ;
- F-050 (sources de connaissance) : fournit la référence pour hallucinations
  et respect des claims — même lot, à livrer avant le scoring de ce critère ;
- F-042 (Setter), F-009 (recherche), F-030 (génération) : capacités
  évaluées, livrées ;
- F-051 (analytics) : livrée — expose coûts et volumes ;
- F-033 (approbations) : livrée — porte l’adoption des recommandations.

## Questions résolues avant développement

- l’évaluation est par runs sur jeux de référence, pas un filtre en ligne en
  production ;
- le mode shadow n’a aucun effet métier — il produit uniquement des
  `ai_runs` marqués ;
- les métriques objectivables sont calculées par le harness ; seules les
  notes qualitatives (qualité message/CTA) utilisent une grille, versionnée
  avec le jeu ;
- aucune application automatique d’optimisation — invariant non négociable
  du catalogue ;
- l’évaluation compare les modèles Kimi configurés du workspace entre eux ;
  l’ajout d’un autre fournisseur est hors périmètre.
