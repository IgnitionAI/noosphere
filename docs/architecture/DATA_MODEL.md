# Modèle de données PostgreSQL

## 1. Conventions

- clés primaires UUID générées côté serveur ou PostgreSQL ;
- `workspace_id` obligatoire sur toutes les tables métier ;
- `created_at`, `updated_at` sur les entités mutables ;
- `deleted_at` pour les suppressions métier récupérables ;
- `timestamptz` pour tous les instants ;
- `jsonb` réservé aux payloads externes, snapshots et critères réellement
  variables, pas aux relations principales ;
- montants en `numeric(19,4)` avec devise ISO séparée ;
- index composites commencent par `workspace_id` ;
- toutes les FK inter-workspace sont protégées par FK composite ou validées
  dans le repository et couvertes par tests d’isolation.

## 2. Workspace et stratégie GTM

```mermaid
erDiagram
    AUTH_USER ||--o{ WORKSPACE_MEMBER : joins
    WORKSPACE ||--o{ WORKSPACE_MEMBER : owns
    WORKSPACE ||--o{ WORKSPACE_INVITATION : issues
    WORKSPACE ||--o{ OFFER : owns
    OFFER ||--o{ OFFER_VERSION : publishes
    OFFER_VERSION ||--o{ OFFER_CLAIM : contains
    WORKSPACE ||--o{ ICP : owns
    ICP ||--o{ ICP_VERSION : publishes
    ICP_VERSION ||--o{ ICP_CRITERION : contains
    WORKSPACE ||--o{ MESSAGING_STRATEGY : owns
    MESSAGING_STRATEGY ||--o{ MESSAGING_STRATEGY_VERSION : publishes
    WORKSPACE ||--o{ AI_POLICY : owns
    AI_POLICY ||--o{ AI_POLICY_VERSION : publishes

    AUTH_USER {
        uuid id PK
        citext email UK
        string name
        timestamptz created_at
    }
    WORKSPACE {
        uuid id PK
        string slug UK
        string name
        string status
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }
    WORKSPACE_MEMBER {
        uuid workspace_id PK,FK
        uuid user_id PK,FK
        string role
        string status
        timestamptz joined_at
    }
    WORKSPACE_INVITATION {
        uuid id PK
        uuid workspace_id FK
        citext email
        string role
        string token_hash UK
        timestamptz expires_at
        timestamptz accepted_at
    }
    OFFER {
        uuid id PK
        uuid workspace_id FK
        string name
        string status
        int current_version
        timestamptz deleted_at
    }
    OFFER_VERSION {
        uuid id PK
        uuid workspace_id FK
        uuid offer_id FK
        int version
        string category
        string value_proposition
        jsonb commercial_rules
        uuid published_by FK
        timestamptz published_at
    }
    OFFER_CLAIM {
        uuid id PK
        uuid workspace_id FK
        uuid offer_version_id FK
        string claim
        string validation_status
        string evidence_uri
    }
    ICP {
        uuid id PK
        uuid workspace_id FK
        string name
        int current_version
        timestamptz deleted_at
    }
    ICP_VERSION {
        uuid id PK
        uuid workspace_id FK
        uuid icp_id FK
        int version
        string description
        jsonb persona_definition
        uuid published_by FK
        timestamptz published_at
    }
    ICP_CRITERION {
        uuid id PK
        uuid workspace_id FK
        uuid icp_version_id FK
        string dimension
        string operator
        jsonb expected_value
        numeric weight
        boolean exclusion
    }
    MESSAGING_STRATEGY {
        uuid id PK
        uuid workspace_id FK
        string name
    }
    MESSAGING_STRATEGY_VERSION {
        uuid id PK
        uuid workspace_id FK
        uuid strategy_id FK
        int version
        jsonb rules
        timestamptz published_at
    }
    AI_POLICY {
        uuid id PK
        uuid workspace_id FK
        string name
    }
    AI_POLICY_VERSION {
        uuid id PK
        uuid workspace_id FK
        uuid policy_id FK
        int version
        jsonb autonomy_rules
        jsonb escalation_rules
        timestamptz published_at
    }
```

Contraintes principales :

- `UNIQUE (offer_id, version)`, `UNIQUE (icp_id, version)` ;
- versions publiées interdites en `UPDATE` et `DELETE` ;
- `UNIQUE (workspace_id, lower(name))` pour les conteneurs actifs ;
- Better Auth peut posséder ses tables techniques ; `AUTH_USER` représente ici
  la projection d’identité référencée par le domaine.

## 3. Prospect Intelligence

```mermaid
erDiagram
    WORKSPACE ||--o{ COMPANY : owns
    COMPANY ||--o{ COMPANY_DOMAIN : identifies
    COMPANY ||--o{ COMPANY_EXTERNAL_ID : identifies
    COMPANY ||--o{ COMPANY_SIGNAL : exhibits
    WORKSPACE ||--o{ CONTACT : owns
    CONTACT ||--o{ CONTACT_IDENTITY : identifies
    CONTACT ||--o{ EMPLOYMENT : has
    COMPANY ||--o{ EMPLOYMENT : employs
    CONTACT ||--o{ CONTACT_SIGNAL : exhibits
    CONTACT ||--o{ ENRICHMENT_OBSERVATION : receives
    COMPANY ||--o{ ENRICHMENT_OBSERVATION : receives
    CONTACT ||--o{ MERGE_CANDIDATE : source
    CONTACT ||--o{ MERGE_CANDIDATE : target
    CONTACT ||--o{ CONTACT_MERGE : merged
    WORKSPACE ||--o{ SUPPRESSION : owns

    COMPANY {
        uuid id PK
        uuid workspace_id FK
        string legal_name
        string display_name
        string country_code
        int employee_count
        string industry
        string linkedin_url
        timestamptz deleted_at
    }
    COMPANY_DOMAIN {
        uuid id PK
        uuid workspace_id FK
        uuid company_id FK
        citext domain
        boolean is_primary
        string verification_status
    }
    COMPANY_EXTERNAL_ID {
        uuid id PK
        uuid workspace_id FK
        uuid company_id FK
        string provider
        string external_id
    }
    COMPANY_SIGNAL {
        uuid id PK
        uuid workspace_id FK
        uuid company_id FK
        string signal_type
        timestamptz occurred_at
        string source_uri
        numeric confidence
        jsonb evidence
    }
    CONTACT {
        uuid id PK
        uuid workspace_id FK
        string first_name
        string last_name
        string display_name
        string locale
        string status
        timestamptz deleted_at
    }
    CONTACT_IDENTITY {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        string type
        string normalized_value
        string display_value
        string verification_status
        string provider
        numeric confidence
        timestamptz last_observed_at
    }
    EMPLOYMENT {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        uuid company_id FK
        string title
        string seniority
        date started_on
        date ended_on
        boolean is_current
        numeric confidence
        string source_uri
        timestamptz observed_at
    }
    CONTACT_SIGNAL {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        string signal_type
        timestamptz occurred_at
        string source_uri
        numeric confidence
        jsonb evidence
    }
    ENRICHMENT_OBSERVATION {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        uuid company_id FK
        string provider
        string field_name
        jsonb observed_value
        numeric confidence
        string evidence_uri
        timestamptz observed_at
    }
    MERGE_CANDIDATE {
        uuid id PK
        uuid workspace_id FK
        uuid source_contact_id FK
        uuid target_contact_id FK
        numeric confidence
        jsonb reasons
        string status
        uuid reviewed_by FK
    }
    CONTACT_MERGE {
        uuid id PK
        uuid workspace_id FK
        uuid survivor_contact_id FK
        uuid merged_contact_id FK
        jsonb snapshot_before
        uuid merged_by FK
        timestamptz merged_at
        timestamptz reverted_at
    }
    SUPPRESSION {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        string identity_hash
        string channel
        string scope
        string reason
        string source
        timestamptz created_at
        timestamptz revoked_at
    }
```

Index et contraintes :

- `UNIQUE (workspace_id, domain)` sur `COMPANY_DOMAIN` actif ;
- `UNIQUE (workspace_id, provider, external_id)` ;
- `UNIQUE (workspace_id, type, normalized_value)` pour les identités certaines ;
- un seul emploi courant par couple contact/entreprise, avec index partiel ;
- pas de chevauchement incohérent de périodes après validation ;
- `CHECK (contact_id IS NOT NULL OR company_id IS NOT NULL)` sur observation ;
- `CHECK (contact_id IS NOT NULL OR identity_hash IS NOT NULL)` sur suppression ;
- index sur `(workspace_id, signal_type, occurred_at DESC)`.

## 4. Campagnes et outreach

```mermaid
erDiagram
    OFFER_VERSION ||--o{ CAMPAIGN : sells
    ICP_VERSION ||--o{ CAMPAIGN : targets
    MESSAGING_STRATEGY_VERSION ||--o{ CAMPAIGN : guides
    AI_POLICY_VERSION ||--o{ CAMPAIGN : governs
    SEQUENCE_VERSION ||--o{ CAMPAIGN : executes
    SEQUENCE ||--o{ SEQUENCE_VERSION : publishes
    SEQUENCE_VERSION ||--o{ SEQUENCE_STEP : contains
    CAMPAIGN ||--o{ CAMPAIGN_PROSPECT : enrolls
    CONTACT ||--o{ CAMPAIGN_PROSPECT : participates
    CAMPAIGN_PROSPECT ||--o{ SCORE_EXPLANATION : scores
    CAMPAIGN_PROSPECT ||--o{ APPROVAL : requires
    CAMPAIGN_PROSPECT ||--o{ SEQUENCE_ENROLLMENT : starts
    SEQUENCE_ENROLLMENT ||--o{ OUTREACH_ACTION : schedules
    SEQUENCE_STEP ||--o{ OUTREACH_ACTION : instantiates
    CONNECTED_ACCOUNT ||--o{ OUTREACH_ACTION : sends
    OUTREACH_ACTION ||--o{ OUTREACH_ATTEMPT : attempts

    CAMPAIGN {
        uuid id PK
        uuid workspace_id FK
        uuid offer_version_id FK
        uuid icp_version_id FK
        uuid messaging_version_id FK
        uuid ai_policy_version_id FK
        uuid sequence_version_id FK
        string name
        string status
        timestamptz activated_at
        timestamptz completed_at
    }
    SEQUENCE {
        uuid id PK
        uuid workspace_id FK
        string name
        int current_version
    }
    SEQUENCE_VERSION {
        uuid id PK
        uuid workspace_id FK
        uuid sequence_id FK
        int version
        timestamptz published_at
    }
    SEQUENCE_STEP {
        uuid id PK
        uuid workspace_id FK
        uuid sequence_version_id FK
        int position
        string channel
        int delay_seconds
        jsonb execution_conditions
        jsonb fallback_policy
        jsonb content_instruction
        jsonb send_window
    }
    CAMPAIGN_PROSPECT {
        uuid id PK
        uuid workspace_id FK
        uuid campaign_id FK
        uuid contact_id FK
        uuid company_id FK
        string status
        numeric score
        string score_version
        int priority
        timestamptz enrolled_at
    }
    SCORE_EXPLANATION {
        uuid id PK
        uuid workspace_id FK
        uuid campaign_prospect_id FK
        string factor
        numeric contribution
        jsonb evidence_refs
    }
    APPROVAL {
        uuid id PK
        uuid workspace_id FK
        string subject_type
        uuid subject_id
        string decision
        uuid decided_by FK
        string comment
        timestamptz decided_at
    }
    SEQUENCE_ENROLLMENT {
        uuid id PK
        uuid workspace_id FK
        uuid campaign_prospect_id FK
        string status
        int current_position
        string suspension_reason
        timestamptz started_at
        timestamptz suspended_at
        timestamptz completed_at
    }
    CONNECTED_ACCOUNT {
        uuid id PK
        uuid workspace_id FK
        string provider
        string channel
        string external_account_id
        string credential_ref
        string status
        jsonb limits
        timestamptz last_health_at
    }
    OUTREACH_ACTION {
        uuid id PK
        uuid workspace_id FK
        uuid enrollment_id FK
        uuid sequence_step_id FK
        uuid connected_account_id FK
        string channel
        string status
        string idempotency_key UK
        timestamptz due_at
        timestamptz locked_at
        jsonb content_snapshot
    }
    OUTREACH_ATTEMPT {
        uuid id PK
        uuid workspace_id FK
        uuid outreach_action_id FK
        int attempt_number
        string provider_request_id
        string status
        string error_code
        timestamptz attempted_at
    }
```

Contraintes :

- `UNIQUE (campaign_id, contact_id)` ;
- `UNIQUE (sequence_version_id, position)` ;
- index partiel unique sur `(workspace_id, contact_id)` via
  `CampaignProspect`/`SequenceEnrollment` lorsque l’enrollment est actif ;
- campagne active interdite en modification sur ses cinq versions ;
- action en exécution verrouillée par lease avec expiration ;
- relecture des suppressions et limites juste avant transition vers
  `executing`.

## 5. Inbox, pipeline, IA et système

```mermaid
erDiagram
    CONTACT ||--o{ CONVERSATION : participates
    CONNECTED_ACCOUNT ||--o{ CONVERSATION : hosts
    CONVERSATION ||--o{ MESSAGE : contains
    MESSAGE ||--o{ REPLY_CLASSIFICATION : classified
    MESSAGE ||--o{ REPLY_DRAFT : inspires
    REPLY_DRAFT ||--o{ APPROVAL : requires
    CONTACT ||--o{ OPPORTUNITY : creates
    OPPORTUNITY ||--o{ OPPORTUNITY_STAGE_HISTORY : records
    OPPORTUNITY ||--o{ MEETING : schedules
    WORKSPACE ||--o{ KNOWLEDGE_SOURCE : owns
    KNOWLEDGE_SOURCE ||--o{ KNOWLEDGE_DOCUMENT : contains
    KNOWLEDGE_DOCUMENT ||--o{ KNOWLEDGE_CHUNK : splits
    AIRUN ||--o{ AI_RETRIEVAL : uses
    KNOWLEDGE_CHUNK ||--o{ AI_RETRIEVAL : cited
    WORKSPACE ||--o{ AIRUN : owns
    WORKSPACE ||--o{ INTEGRATION_EVENT : receives
    WORKSPACE ||--o{ OUTBOX_EVENT : emits
    WORKSPACE ||--o{ AUDIT_LOG : audits

    CONVERSATION {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        uuid connected_account_id FK
        string provider_thread_id
        string channel
        string status
        timestamptz last_message_at
    }
    MESSAGE {
        uuid id PK
        uuid workspace_id FK
        uuid conversation_id FK
        string provider_message_id
        string direction
        string sender_type
        text body
        jsonb attachments
        timestamptz sent_at
        timestamptz received_at
    }
    REPLY_CLASSIFICATION {
        uuid id PK
        uuid workspace_id FK
        uuid message_id FK
        string intent
        numeric confidence
        uuid ai_run_id FK
        uuid reviewed_by FK
    }
    REPLY_DRAFT {
        uuid id PK
        uuid workspace_id FK
        uuid message_id FK
        uuid ai_run_id FK
        text body
        string status
        timestamptz created_at
    }
    OPPORTUNITY {
        uuid id PK
        uuid workspace_id FK
        uuid contact_id FK
        uuid company_id FK
        uuid offer_version_id FK
        uuid owner_id FK
        string stage
        numeric estimated_value
        string currency
        numeric probability
        string next_action
        date expected_close_on
        string loss_reason
        numeric actual_revenue
    }
    OPPORTUNITY_STAGE_HISTORY {
        uuid id PK
        uuid workspace_id FK
        uuid opportunity_id FK
        string from_stage
        string to_stage
        uuid changed_by FK
        timestamptz changed_at
    }
    MEETING {
        uuid id PK
        uuid workspace_id FK
        uuid opportunity_id FK
        string provider
        string external_event_id
        timestamptz starts_at
        string status
    }
    KNOWLEDGE_SOURCE {
        uuid id PK
        uuid workspace_id FK
        string source_type
        string name
        string status
        jsonb metadata
    }
    KNOWLEDGE_DOCUMENT {
        uuid id PK
        uuid workspace_id FK
        uuid source_id FK
        string object_uri
        string checksum
        string validation_status
        timestamptz indexed_at
    }
    KNOWLEDGE_CHUNK {
        uuid id PK
        uuid workspace_id FK
        uuid document_id FK
        text content
        tsvector search_vector
        vector embedding
        jsonb metadata
    }
    AIRUN {
        uuid id PK
        uuid workspace_id FK
        string purpose
        string provider
        string model
        string prompt_version
        string input_hash
        jsonb parameters
        jsonb output
        string status
        numeric cost
        int latency_ms
        timestamptz created_at
    }
    AI_RETRIEVAL {
        uuid id PK
        uuid workspace_id FK
        uuid ai_run_id FK
        uuid chunk_id FK
        numeric score
        int rank
    }
    INTEGRATION_EVENT {
        uuid id PK
        uuid workspace_id FK
        string provider
        string external_event_id
        string event_type
        jsonb payload
        string status
        timestamptz received_at
        timestamptz processed_at
    }
    OUTBOX_EVENT {
        uuid id PK
        uuid workspace_id FK
        string aggregate_type
        uuid aggregate_id
        string event_type
        jsonb payload
        int attempts
        timestamptz available_at
        timestamptz published_at
    }
    AUDIT_LOG {
        bigint id PK
        uuid workspace_id FK
        uuid actor_user_id FK
        string action
        string subject_type
        uuid subject_id
        jsonb changes
        string correlation_id
        timestamptz created_at
    }
```

Contraintes et index :

- `UNIQUE (workspace_id, provider_thread_id, connected_account_id)` ;
- `UNIQUE (workspace_id, provider_message_id, connected_account_id)` ;
- `UNIQUE (provider, external_event_id)` ou clé équivalente tenant-aware ;
- GIN sur `search_vector`, index vectoriel seulement après activation pgvector ;
- `AIRun.output` soumis à une politique de rétention distincte des métriques ;
- audit append-only ;
- outbox indexée sur `(published_at, available_at)` ;
- messages entrants persistés avant toute classification IA.

## 6. Recherche produit F-009

La première migration implémente :

- `product_research_runs` pour le brief, l’état et l’étape active ;
- `research_stage_runs` pour les checkpoints, tentatives et verrous humains ;
- `market_evidence`, `competitor_candidates`, `research_findings` et
  `icp_proposals` pour le livrable sourcé ;
- `ai_runs` pour le fournisseur, modèle, prompt, coût et latence ;
- `jobs` pour les leases PostgreSQL, retries et dead letters ;
- `outbox_events` pour les événements enregistrés avec la transition.

Les FK composites `(workspace_id, id)` empêchent une relation de recherche de
pointer vers un autre workspace. Le résultat complet d’une étape reste dans son
checkpoint ; les tables de livrable sont les projections révisables utilisées
par le rapport.

## 7. Vues et projections

Les écrans de recherche et analytics utilisent des vues SQL ou vues
matérialisées, jamais des agrégats transactionnels dénormalisés prématurément :

- `prospect_search_view` ;
- `campaign_performance_view` ;
- `inbox_unread_view` ;
- `pipeline_summary_view` ;
- `sender_account_health_view`.

Les projections sont reconstruisibles depuis les tables sources. Une
incohérence de projection ne doit jamais modifier l’état métier.
