# Flux critiques Noosphere

> Statut : **AS-IS**, vérifié le 24 août 2026.
> Les critères observables de bout en bout sont définis dans
> [`PRODUCT_TRUTH_CONTRACTS.md`](./PRODUCT_TRUTH_CONTRACTS.md).

Noosphere possède deux moteurs, Outbound et Content Inbound, qui partagent le
CRM, les conversations, les appels, la connaissance et la mémoire Prospect 360.
Les écrans déclenchent ou consultent des commandes durables ; fermer une page,
un drawer ou un navigateur n'annule jamais un job.

## 1. Première mise en service

```mermaid
flowchart LR
    W[Workspace] --> O[Offre et preuves]
    O --> I[Étude ICP]
    I --> A[Comptes associés]
    A --> P[Policies et cadence]
    P --> C[Agenda]
    C --> R[Prêt]
```

La configuration peut être complétée progressivement. Une capacité n'est
activée que lorsque ses prérequis sont sains : une campagne LinkedIn exige un
compte LinkedIn, une publication exige une stratégie et un compte capable de
publier, un Setter exige une conversation et une policy autorisant l'action.

## 2. Étude ICP vers campagnes Outbound

```mermaid
sequenceDiagram
    participant UI
    participant API
    participant DB as PostgreSQL + outbox
    participant Worker
    participant AI
    participant Sources as Crawler / Unipile

    UI->>API: Lancer une étude ICP
    API->>DB: Run + première étape + job + outbox
    API-->>UI: 202 + runId
    Worker->>DB: Réserver le job avec lease
    Worker->>AI: Construire l'agent de cette invocation
    AI->>Sources: Rechercher et lire via les outils bornés
    Sources-->>AI: Faits, profils et preuves
    AI-->>Worker: Sortie structurée
    Worker->>DB: Checkpoint + preuves + étape suivante
    Worker->>DB: ICP + campagnes + jobs de sourcing
    UI->>API: Relire le run ou quitter la page
    API-->>UI: État durable inchangé
```

L'agent n'est jamais la mémoire du run. Chaque invocation reconstruit son
contexte depuis PostgreSQL, les documents autorisés et les checkpoints.

## 3. Sourcing et exécution d'une campagne

```mermaid
sequenceDiagram
    participant Scheduler
    participant DB
    participant AI
    participant Channel as Port de canal
    participant Provider

    Scheduler->>DB: Réserver une action due avec lease
    Scheduler->>DB: Charger offre, ICP, prospect, preuves, mémoire et thread
    Scheduler->>AI: Générer ou critiquer le message
    AI-->>Scheduler: Décision + message structurés
    Scheduler->>DB: Revalider compte, policy, quota, fenêtre et suppression
    alt action bloquée
        Scheduler->>DB: Exception ou action annulée
    else action autorisée
        Scheduler->>Channel: Effet avec requestKey et snapshot
        Channel->>Provider: Appel fournisseur
        Provider-->>Channel: Identifiant et statut
        Channel-->>Scheduler: Résultat normalisé
        Scheduler->>DB: Attempt + transition + outbox
    end
```

Le chemin normal est autonome. Une validation humaine n'est pas un prérequis ;
elle reste une commande explicite lorsque l'utilisateur reprend la main. Les
exceptions sont locales : opt-out, risque juridique ou sécurité, demande de
prix/négociation, compte dégradé, quota ou résultat provider ambigu.

## 4. Réponse entrante et Setter IA

```mermaid
sequenceDiagram
    participant Provider
    participant Webhook
    participant DB
    participant SetterWorker
    participant AI

    Provider->>Webhook: Événement signé ou synchronisé
    Webhook->>DB: Événement unique + message entrant + job
    Webhook-->>Provider: Accepté
    SetterWorker->>DB: Suspendre les relances du contact
    SetterWorker->>DB: Charger Prospect 360 + thread récent + policy
    SetterWorker->>AI: Nouvelle invocation sans état partagé
    AI-->>SetterWorker: Intention + prochaine action + brouillon
    SetterWorker->>DB: Décision durable et audit
    alt réponse autorisée
        SetterWorker->>Provider: Répondre avec une requestKey
        SetterWorker->>DB: Attempt et résultat
    else exception ou pilotage humain
        SetterWorker->>DB: Ne pas envoyer, exposer l'action
    end
```

Cliquer sur **Setter IA** crée une commande durable. Fermer le panneau ne tue
ni le job ni le processus worker. Une conversation hors campagne reste en
pilotage humain, sauf commande explicite du Setter pour ce thread.

## 5. Mémoire Prospect 360

```mermaid
flowchart TB
    M[Messages et conversations] --> E[Événements mémoire]
    C[Campagnes et décisions] --> E
    S[Interactions sociales] --> E
    A[Appels et opportunités] --> E
    E --> MW[Memory worker]
    MW --> F[Faits confirmés]
    MW --> O[Objections et engagements]
    MW --> N[Prochaine action]
    MW --> R[Résumé durable]
    F --> X[Contexte d'une nouvelle invocation]
    O --> X
    N --> X
    R --> X
    T[Derniers messages bruts] --> X
```

La mémoire est centrale par prospect et séparée de toute instance d'agent. Les
faits sensibles gardent leur provenance. Les synthèses sont versionnées et
peuvent être remplacées ; l'historique brut reste la source de vérité.

## 6. Content Inbound LinkedIn

```mermaid
sequenceDiagram
    participant Scheduler
    participant DB
    participant Research
    participant AI
    participant Publisher
    participant LinkedIn

    Scheduler->>DB: Déclencher la boucle éditoriale
    Research->>DB: Sources et idées dédupliquées
    AI->>DB: Brief + texte + assets + audits
    DB->>DB: Snapshot immuable + publication planifiée
    Scheduler->>DB: Réserver la publication avec lease
    Scheduler->>DB: Revalider compte, cadence, claims et policy
    Scheduler->>Publisher: Publier avec requestKey
    Publisher->>LinkedIn: Appel provider
    LinkedIn-->>Publisher: Résultat observable
    Publisher->>DB: Attempt + statut + identifiant distant
```

Le calendrier affiche le contenu complet du snapshot qui sera publié. Modifier
la cadence replanifie les publications non parties, y compris lors d'un
changement de fuseau horaire.

## 7. Engagement social vers conversation et appel

```mermaid
flowchart LR
    P[Publication] --> I[Interaction sociale]
    I --> X{Identité résolue ?}
    X -->|non| U[Signal non attribué]
    X -->|oui| C[Contact / Prospect 360]
    C --> D{Policy et intention}
    D -->|observer| S[Signal durable]
    D -->|conversation permise| M[Conversation]
    M --> Q[Qualification]
    Q --> A[Appel]
    A --> T[Attribution prouvée ou inconnue]
```

Une réaction seule ne déclenche jamais automatiquement un message direct. La
proximité temporelle n'est pas présentée comme une causalité.

## 8. Documents et recherche hybride

```mermaid
sequenceDiagram
    participant UI
    participant Store as MinIO
    participant Worker
    participant Extractor
    participant TEI
    participant DB as ParadeDB / pgvector

    UI->>Store: Upload direct autorisé
    UI->>Worker: Job d'ingestion durable
    Worker->>Extractor: PDF, DOCX, PPTX, XLSX, HTML ou texte
    Extractor-->>Worker: Markdown + sections + provenance
    alt OCR nécessaire
        Worker->>DB: ocr_required, zéro chunk
    else exploitable
        Worker->>DB: Document + chunk set + chunks
        Worker->>TEI: Qwen3 Embedding 0.6B, 1024 dimensions
        TEI-->>Worker: Vecteurs normalisés
        Worker->>DB: Embeddings versionnés
    end
```

Une recherche normale applique d'abord les permissions et métadonnées, puis
combine BM25 ParadeDB et candidats vectoriels, fusionne par RRF et reranke avec
BGE. Si l'embedding est indisponible, le mode lexical dégradé reste explicite.

## 9. Rendez-vous et attribution

L'IA peut proposer des créneaux via `CalendarProvider`. La confirmation crée
le rendez-vous externe puis sa projection locale. Les événements calendrier
réconcilient déplacement et annulation de manière idempotente. L'origine
`inbound`, `outbound`, `mixed` ou `unknown` est distincte du fait qu'une
conversation soit dans ou hors campagne.

## 10. Reprise et erreurs

| Situation | Comportement |
|---|---|
| fermeture de page ou drawer | aucune mutation du job ; l'UI relit l'état durable |
| crash worker | lease expirée puis reprise idempotente |
| validation métier | état terminal ou exception, sans retry aveugle |
| timeout, 429 ou 5xx provider | backoff borné |
| credential invalide | compte dégradé et effets suspendus |
| résultat provider inconnu | tentative à réconcilier, jamais doublée volontairement |
| OCR nécessaire | document conservé, zéro chunk et raison actionnable |
| TEI embedding indisponible | recherche lexicale dégradée ; backfill repris plus tard |

Un job peut être livré plusieurs fois. Chaque effet externe possède donc une
clé d'idempotence stable et chaque transition durable écrit son événement
outbox dans la même transaction.
