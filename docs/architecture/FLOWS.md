# Flux critiques

## 1. Création et activation d’une campagne

```mermaid
sequenceDiagram
    participant Assessment as Évaluation canal
    participant DB as PostgreSQL
    participant Worker
    participant AI

    Assessment->>DB: Canal recommended
    Assessment->>DB: Campagne + run + job + outbox
    Worker->>DB: Consommer recherche/enrichissement
    Worker->>AI: Personnaliser avec faits et preuves
    AI-->>Worker: Messages structurés
    Worker->>DB: Sauver CampaignProspects
    Worker->>DB: Preflight déterministe
    Worker->>DB: Publier séquence + enrollments + actions
```

Activation automatique refusée si une version manque, si la séquence est
invalide, si aucun prospect n’est éligible ou si aucun compte compatible n’est
sain.

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

    Provider->>Webhook: Événement signé
    Webhook->>DB: INSERT IntegrationEvent unique
    Webhook-->>Provider: 202 Accepted
    Worker->>DB: Persister conversation et message
    Worker->>DB: Suspendre séquences du contact
    Worker->>AI: Classifier avec contexte et preuves
    AI-->>Worker: intention + action + réponse structurée
    Worker->>DB: Classification + AutomatedReply ou suppression
    alt réponse ou rendez-vous
        Worker->>Provider: Envoyer dans le même thread
    else refus ou opposition
        Worker->>DB: Stopper et supprimer durablement le canal
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
