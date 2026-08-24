# PTC-IN-LI-001 — LinkedIn Content Inbound

## Contrat

| Champ | Décision |
|---|---|
| Contract ID | `PTC-IN-LI-001` |
| Product claim | Noosphere peut transformer une stratégie sourcée en un post LinkedIn unique, synchroniser une interaction réelle, la relier à un prospect et une conversation, puis attribuer un rendez-vous. |
| Niveau de preuve requis | L4 |
| Acteur | Owner du workspace IgnitionAI et workers Noosphere |
| État initial | Offre et ICP publiés, stratégie éditoriale active, asset sourcé et prêt, compte LinkedIn Unipile connecté et sélectionné, agenda connecté. |
| Déclencheur | Planifier l’asset canary explicitement autorisé avec `canary:linkedin`. |
| Résultat observable | Publication avec ID et URL provider, interaction réelle synchronisée, signal CRM exact, conversation, réponse provider et booking attribué. |
| Continuation critique | Rejouer le même request key après redémarrage sans créer un second post, puis synchroniser l’engagement. |
| Topologie requise | Web, API, worker général, PostgreSQL, outbox/queue, Unipile, compte LinkedIn réel, agenda et authentification. |
| Signaux d’échec | Compte/hash différents, absence d’ID provider, statut `unknown` sans verdict, doublon, interaction injectée, identité ambiguë, réponse non envoyée, booking sans touche d’attribution. |
| Substituts interdits | Provider mocké, post copié manuellement, interaction insérée en base, screenshot seul, HTTP 200 isolé, modification SQL manuelle. |
| Commande de preuve | `bun run canary:linkedin` en modes `preflight`, `publish`, puis `verify`. |
| Artefacts | Rapport JSON expurgé, URL LinkedIn, IDs provider, correlation/request key, logs de redémarrage, traces d’attribution. |
| Produit de référence | Sans objet : aucune revendication de parité. |

## Traçabilité du parcours

| Étape | Composant ou donnée | Assertion observable | Diagnostic d’échec |
|---|---|---|---|
| Stratégie | `editorial_strategy_versions` | version active et liée à offre + ICP | `LINKEDIN_CANARY_STRATEGY_NOT_ACTIVE` |
| Idée | `content_ideas` + sources | au moins une source durable | `LINKEDIN_CANARY_IDEA_NOT_SOURCED` |
| Contenu | brief + asset version | asset prêt et hash exact autorisé | `LINKEDIN_CANARY_ASSET_NOT_READY`, `...CONTENT_MISMATCH` |
| Compte | sélection workspace + Unipile | compte exact, connecté, capacité texte disponible | `...ACCOUNT_MISMATCH`, `...CAPABILITY_UNAVAILABLE` |
| Publication | job durable + `SocialPublisher` | ID et URL provider uniques | publication `failed`/`unknown`, doublon |
| Reprise | request key + état durable | même publication après redémarrage, zéro nouveau post | ID différent ou `duplicateProviderPostCount > 0` |
| Interaction | sync Unipile | commentaire/réponse/mention provider entrant | aucune interaction réelle |
| CRM | attribution d’identité exacte | signal social éligible, pas un simple like | identité ambiguë ou réaction inerte |
| Conversation | attribution + messages | conversation LinkedIn et réponse provider sortante | conversation/réponse absente |
| Appel | agenda + attribution | booking et touche d’attribution | booking non relié |

## Garde-fous du runner

- `preflight` n’écrit rien chez le provider ;
- `publish` exige simultanément la phrase exacte
  `PUBLISH_ONE_AUTHORIZED_LINKEDIN_CANARY`, l’ID du compte autorisé et le SHA-256
  exact du contenu autorisé ;
- l’asset relu en base doit être sourcé, prêt et rattaché à une stratégie active ;
- le compte sélectionné en base et celui observé chez Unipile doivent être le même ;
- le rapport ne conserve ni corps du post, ni cookie, ni clé API ;
- `verify` sort avec le code `2` tant que tous les claims L4 ne passent pas.

## Rapport d’acceptation actuel

| Claim | Niveau | Preuve | Résultat |
|---|---:|---|---|
| Contrat et gate fail-closed | L1 | tests `linkedin-product-truth-canary.test.ts` | Pass |
| Chaîne simulée et projections | L2 | tests intégration Content/Symbiose | Pass |
| Préflight compte, capacité et contenu exacts | L3 | rapport expurgé `/tmp/noosphere-ptc-ca4ec98d-b2ff-4ec2-afa4-84add9c88cd8.json` du 22 août 2026 | Pass : compte `connected`, capacité texte disponible, chaîne sourcée et hash exacts |
| Publication LinkedIn réelle autorisée | L4 | rapport `canary:linkedin` | Non exécutée : aucune mutation provider autorisée dans cette exécution |
| Interaction → conversation → booking | L4 | rapport `canary:linkedin` | Bloqué tant que le post réel n’existe pas |

État courant : `implemented_unverified`.

Cet état interdit de déclarer l’Inbound LinkedIn « prêt » avant le rapport réel
`product_verified`.
