# Flux critiques

## 1. Création et activation d’une campagne

```mermaid
sequenceDiagram
    actor Operator as Opérateur
    participant UI
    participant CampaignUC as Cas d’usage Campaign
    participant Domain
    participant DB as PostgreSQL
    participant Worker
    participant AI

    Operator->>UI: Sélectionne OfferVersion + ICPVersion
    UI->>CampaignUC: Créer campagne
    CampaignUC->>Domain: Vérifier versions publiées
    Domain-->>CampaignUC: Campagne draft
    CampaignUC->>DB: Sauver campagne + outbox
    Worker->>DB: Consommer recherche/enrichissement
    Worker->>AI: Scorer et expliquer
    AI-->>Worker: Score + preuves
    Worker->>DB: Sauver CampaignProspects
    Operator->>UI: Examine et approuve la séquence
    UI->>CampaignUC: Approuver et activer
    CampaignUC->>Domain: approve() puis activate()
    Domain->>Domain: Figer les cinq versions
    CampaignUC->>DB: Commit état + outbox
```

Activation refusée si une version manque, si la séquence n’est pas approuvée,
ou si aucun compte expéditeur compatible n’est sain.

## 2. Exécution d’une étape outbound

```mermaid
sequenceDiagram
    participant Scheduler
    participant Domain
    participant DB
    participant Channel as CommunicationChannel
    participant Provider as Unipile

    Scheduler->>DB: Réserver action due avec lease
    Scheduler->>Domain: prepareExecution(action)
    Domain->>DB: Vérifier enrollment actif
    Domain->>DB: Vérifier suppression et limites
    alt bloqué ou réponse reçue
        Domain->>DB: Marquer skipped/cancelled
    else autorisé
        Scheduler->>Channel: send(idempotencyKey, snapshot)
        Channel->>Provider: Appel fournisseur
        Provider-->>Channel: requestId / statut
        Channel-->>Scheduler: résultat normalisé
        Scheduler->>DB: Attempt + transition + outbox
    end
```

Le contenu envoyé est le snapshot approuvé. Un retry réutilise la même clé
d’idempotence et ne régénère pas silencieusement le message.

## 3. Réponse entrante

```mermaid
sequenceDiagram
    participant Provider
    participant Webhook
    participant DB
    participant Worker
    participant AI
    actor Reviewer as Relecteur

    Provider->>Webhook: Événement signé
    Webhook->>DB: INSERT IntegrationEvent unique
    Webhook-->>Provider: 202 Accepted
    Worker->>DB: Persister conversation et message
    Worker->>DB: Suspendre séquences du contact
    Worker->>AI: Classifier avec contexte et preuves
    AI-->>Worker: intention + confiance + brouillon
    Worker->>DB: Classification + AIRun + ReplyDraft
    Reviewer->>DB: Approuver, modifier ou rejeter
    alt approuvé
        Worker->>Provider: Envoyer réponse validée
    else rejeté
        Worker->>DB: Conserver feedback
    end
```

La suspension précède l’appel IA : une panne de modèle ne doit jamais laisser
partir la relance suivante.

## 4. Déduplication et fusion

1. normaliser les identités observées ;
2. chercher une identité certaine dans le workspace ;
3. fusionner automatiquement uniquement sur correspondance certaine ;
4. créer un `MergeCandidate` pour les correspondances probables ;
5. déplacer les relations dans une transaction ;
6. conserver un snapshot et un journal réversible ;
7. réévaluer les enrollments actifs et suppressions.

## 5. Réservation de rendez-vous

L’IA peut proposer des créneaux via `CalendarProvider`, mais la confirmation
crée d’abord le rendez-vous externe, puis `Meeting` et l’historique de pipeline.
Un événement calendrier idempotent réconcilie annulation ou déplacement.

## 6. Politique de retry

| Type d’erreur | Réponse |
|---|---|
| validation métier | pas de retry, action terminale |
| suppression/restriction | annulation, audit |
| timeout/429/5xx fournisseur | backoff exponentiel borné |
| credential invalide | pause du compte et alerte |
| payload fournisseur inconnu | dead-letter inspectable |
| crash worker | lease expirée puis reprise |

Un job peut être exécuté plusieurs fois ; chaque effet externe doit rester
idempotent.
