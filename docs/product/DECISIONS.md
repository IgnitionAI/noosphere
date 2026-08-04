# Décisions d'architecture produit

## D-006 — Inbox globale et conversations hors campagne (2026-08-04)

**Décision** : la Messagerie devient une vue opérationnelle transverse, en
complément du détail de campagne. Elle synchronise les conversations directes
du fournisseur, y compris celles qui ne proviennent pas d'une campagne, tout en
conservant le contexte campagne lorsqu'il existe.

**Invariants** :

- une conversation hors campagne est identifiée explicitement et ne déclenche
  jamais de réponse automatique ;
- une action manuelle ou une invocation explicite du Setter reste possible dans
  le thread existant ;
- les filtres de canal, campagne, lecture et période sont portés par l'URL ;
- l'amélioration IA d'un brouillon ne crée aucune commande d'envoi ;
- les décisions et automatismes d'une campagne restent consultables depuis sa
  propre vue.

**Remplace** : D-004 pour la décision de ne pas créer d'Inbox globale. Les
invariants de contexte campagne et de navigation sans perte restent valides.

## D-005 — Politique IA, exécution déterministe et contenu juste-à-temps (2026-08-04)

**Décision** : chaque campagne possède une politique d’autopilote versionnée.
K3 choisit et rédige dans les bornes de cette politique ; le domaine calcule
les jours ouvrés, fenêtres, fuseaux, quotas, précédences et conditions d’arrêt.
Le premier contact est composé lors de l’activation, tandis que les relances
sont personnalisées juste avant leur tentative d’envoi.

**Invariants** :

- le fuseau du destinataire est préféré et le workspace fournit le fallback ;
- une relance attend la livraison de l’étape précédente ;
- une réponse entrante suspend l’enrollment et annule les actions futures avant
  tout appel K3 ;
- une activité humaine dans le thread annule toute réponse IA encore en attente ;
- le contenu effectivement envoyé est figé avec son modèle, prompt et politique ;
- une politique n’est plus modifiable une fois sa planification activée afin de
  ne pas réécrire rétroactivement le parcours d’un prospect.

## D-004 — La conversation reste dans la campagne (2026-08-02, remplacée par D-006)

**Décision** : la V1 ne crée pas d’onglet Inbox global. La campagne est la vue
opérationnelle unique : elle regroupe ses prospects, les indicateurs agrégés,
le dernier message et un panneau latéral de conversation ouvert sans changer
de contexte.

**Raisons** :

- l’opérateur raisonne d’abord par ICP et campagne, pas par thread fournisseur ;
- ouvrir une fiche CRM ou une conversation ne doit pas faire perdre la campagne
  d’origine ;
- les décisions K3, réponses automatiques, relances annulées et opportunités ont
  besoin du contexte de la campagne pour rester compréhensibles ;
- une Inbox globale n’apporte de valeur que lorsque le volume de conversations
  transverses le justifie réellement.

**Conséquences** :

- les compteurs visibles sont `ciblés`, `contactés`, `réponses`, `prospects
  chauds` et `rendez-vous` ;
- l’état prospect suit la progression `non contacté` → `envoyé` → `répondu` →
  `qualifié` ou `refusé` → `rendez-vous` ;
- le badge d’attention est réservé aux exceptions techniques ou métier qui
  demandent réellement une intervention ; une recherche sans résultat reste un
  résultat vide, pas une panne ;
- les conversations globales et l’assignation d’équipe sont différées jusqu’à
  validation d’un besoin multi-campagnes.

## D-003 — Autopilote sans validation humaine dans le chemin normal (2026-08-02)

**Décision** : après la configuration initiale du workspace, un ICP V3 publié
enchaîne automatiquement l’évaluation des canaux, le sourcing, l’enrichissement,
la déduplication, le scoring, la personnalisation, le preflight, la
planification, les envois et le traitement des réponses.

**Raisons** :

- une approbation entre chaque étape annule la valeur opérationnelle de l’IA ;
- les décisions éditoriales sont bornées par des sorties structurées et les
  règles critiques restent déterministes ;
- PostgreSQL, les jobs idempotents et l’outbox assurent les reprises sans
  dépendre de la présence de l’utilisateur sur une page ;
- l’interface doit servir à observer et suspendre, pas à faire avancer le pipe.

**Garde-fous automatiques** :

- seuls les canaux `recommended` démarrent par défaut ;
- suppression, identité éligible, compte sain, quota et fenêtre sont revérifiés
  juste avant chaque envoi ;
- une réponse suspend immédiatement les relances du contact ;
- une livraison réseau ambiguë n’est jamais rejouée aveuglément ;
- les erreurs irrécupérables passent la campagne en `attention` avec un audit,
  sans inventer un succès.

## D-002 — Un ICP vient de preuves marché externes, pas de la landing produit (2026-08-01)

**Décision** : F-009 sépare désormais la vérité produit de la vérité marché.
Le domaine du produit peut soutenir les capacités et le positionnement, mais
ne peut jamais soutenir `marketEvidenceIds`. Le workflow ajoute une étape
Deep Agent `buyer_landscape_discovery` entre l’analyse concurrentielle et la
synthèse des segments.

**Raisons** :

- une landing est un document commercial choisi par le vendeur, pas une preuve
  de douleur, de budget ou de volonté d’achat ;
- les concurrents techniques seuls conduisent aux développeurs, ESN et équipes
  internes au lieu des utilisateurs finaux ;
- la prospection exige des secteurs, tailles, titres, signaux et exclusions
  directement transformables en recherches de profils ;
- la capacité et la volonté de construire en interne doivent être testées
  explicitement avant de classer un segment.

**Conséquences** :

- le brief choisit `end_customers`, `channel_partners` ou `both`, avec
  `end_customers` par défaut ;
- chaque segment est typé `end_customer`, `channel_partner` ou
  `internal_builder` ;
- une politique déterministe filtre l’audience, refuse les preuves circulaires,
  recalcule le score de prospectabilité et limite le rapport à cinq ICP ;
- les anciens runs restent sur le workflow V1 à six étapes ; les nouveaux runs
  utilisent le workflow V2 à sept étapes.

## D-001 — Canal d'envoi : Unipile V1 pour tout l'outbound (2026-07-27)

**Décision** : LinkedIn, email professionnel et WhatsApp passent par Unipile V1
(DSN dédié, `/api/v1`, facturation par compte connecté). Resend est conservé
uniquement pour le transactionnel applicatif (invitations, notifications),
comme sur IgnitionRAG.

**Raisons** :

- Unipile facture par compte (49 € jusqu'à 10 comptes, usage illimité) et non
  au volume : coût prévisible pour des séquences 1:1 ;
- les envois partent de vraies boîtes existantes (Gmail/Outlook/IMAP), plus
  proches d'un comportement humain qu'une infra domaine froide ;
- un seul contrat d'intégration pour LinkedIn + email + WhatsApp, déjà celui
  de F-023 (ProspectSource) ;
- la leçon IgnitionRAG est acquise : V1 avec DSN, jamais l'API globale v2.

**Conséquences** :

- F-030 (séquences multicanales) s'appuie sur les comptes Unipile connectés du
  workspace (LinkedIn, boîtes mail, WhatsApp) ;
- F-025 (recherche d'emails professionnels) reste nécessaire : Unipile ne
  *trouve* pas d'emails, il *envoie* depuis des boîtes connectées ;
- les quotas natifs des providers (≈500 emails/jour Gmail, ≈300 Outlook par
  compte) deviennent des règles d'éligibilité canal (F-026) ;
- pas de dépendance à une clé Resend pour la prospection.
