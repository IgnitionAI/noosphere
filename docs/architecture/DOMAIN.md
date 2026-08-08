# Modèle de domaine

## 1. Contextes bornés

| Contexte | Responsabilité | Agrégats principaux |
|---|---|---|
| Workspace | tenant, membres, rôles, invitations | `Workspace`, `WorkspaceMembership` |
| GTM Strategy | offre, ICP, messages et politique IA versionnés | `Offer`, `ICP`, `MessagingStrategy` |
| Prospect Intelligence | entreprises, contacts, identités, emplois, signaux, enrichissements | `Company`, `Contact`, `Suppression` |
| Campaigns | campagne, population, séquence et approbation | `Campaign`, `Sequence`, `CampaignProspect` |
| Outreach | planification et exécution multicanale | `OutreachAction`, `ConnectedAccount` |
| Inbox | conversations, messages et qualification des réponses | `Conversation`, `Message` |
| Pipeline | rendez-vous, opportunités et revenu | `Opportunity`, `Meeting` |
| AI & Knowledge | sources, claims, génération, retrieval et évaluations | `KnowledgeSource`, `AIRun` |
| Analytics | événements et projections de performance | `AnalyticsEvent` |

## 2. Agrégats et comportements

### Workspace

`Workspace` est la frontière de sécurité et de propriété. Il peut inviter un
membre, changer son rôle et désactiver un accès. Better Auth fournit l’identité
et la session, mais n’est pas propriétaire du workspace.

Rôles V1 :

- `owner` : contrôle total et transfert de propriété ;
- `admin` : membres, intégrations, campagnes et politiques ;
- `operator` : prospects, campagnes, inbox et pipeline ;
- `reviewer` : approbations et réponses ;
- `viewer` : lecture seule.

### Offer et ICP

`Offer` et `ICP` sont des conteneurs éditables. Une publication crée
respectivement une `OfferVersion` ou une `ICPVersion` immuable. Une campagne ne
référence jamais la version de travail.

Une `OfferVersion` décrit notamment la catégorie (`service`, `saas`,
`licence`, `autre`), la proposition de valeur, les claims autorisés, les
preuves, objections, prix communicables et contraintes.

Une `ICPVersion` contient les critères d’inclusion, d’exclusion, personas,
géographies, tailles, technologies, signaux et pondérations.

### Company

`Company` représente une entreprise canonique dans un workspace. Elle consolide
des domaines, identifiants externes et signaux sans perdre leurs sources.

Unicité :

- domaine normalisé unique dans le workspace lorsqu’il est connu ;
- identifiant fournisseur unique par fournisseur et workspace ;
- les correspondances probables sont soumises à validation.

### Contact

`Contact` représente une personne stable, indépendamment de son employeur.
`ContactIdentity` porte LinkedIn, email, téléphone, WhatsApp et identifiants
externes. `Employment` historise les postes.

Règle de fusion :

- identité certaine : fusion automatique ;
- identité probable : `MergeCandidate` à valider ;
- nom seul : jamais suffisant.

Une fusion génère un `ContactMerge` réversible et conserve la provenance.

### Suppression

`Suppression` peut viser une identité, un contact ou une empreinte d’identité.
Elle est soit limitée à un canal, soit générale. Une opposition générale
interdit toute nouvelle action multicanale. La suppression survit à
l’anonymisation du contact.

### Campaign

Une campagne capture au démarrage :

- une `OfferVersion` ;
- une `ICPVersion` ;
- une `MessagingStrategyVersion` ;
- une `AIPolicyVersion` ;
- une `SequenceVersion`.

Ces références sont immuables après activation. Modifier une stratégie crée
une nouvelle version ou une nouvelle campagne.

### CampaignProspect

`CampaignProspect` relie un contact à une campagne et porte le score,
l’explication, les preuves, la priorité et l’état d’enrollment. Les données
canoniques restent dans `Contact` et `Company`.

Un contact ne peut avoir qu’une seule séquence active à la fois dans un
workspace. Cette règle est protégée par une contrainte partielle en base.

### Sequence

Une séquence est un playbook linéaire versionné. Chaque `SequenceStep` contient
canal, délai, conditions, fenêtre d’envoi, stratégie de contenu et fallback.
Les canaux V1 sont `linkedin`, `email`, `whatsapp` et `manual_task`.

Une réponse, une opposition, une restriction du compte ou une intervention
manuelle peut suspendre l’enrollment avant l’étape suivante.

### OutreachAction

`OutreachAction` est une intention immuable d’exécution. Sa machine d’état :

`planned → ready → executing → accepted → delivered`

Branches terminales : `skipped`, `failed`, `cancelled`.

Une nouvelle tentative crée une `OutreachAttempt`. La clé d’idempotence empêche
deux envois pour la même action logique.

### Conversation

Une conversation agrège les messages d’un contact sur un canal et un compte
connecté. Une vue unifiée rapproche les conversations d’un même contact sans
effacer les threads fournisseurs.

Toute réponse entrante :

1. suspend les enrollments actifs ;
2. classe l’intention ;
3. génère la réponse dans les bornes de la politique d’autopilote ;
4. l’envoie sans validation humaine dans le chemin normal (D-003), ou la
   remonte en exception (F-033) si elle sort des bornes.

### Opportunity

Pipeline V1 :

`Prospect → Conversation → Qualifié → Rendez-vous → Opportunité → Proposition → Gagné/Perdu`

`Opportunity` conserve offre/version, valeur estimée, probabilité, responsable,
prochaine action, date de clôture et motif de perte. La facturation, les devis,
contrats et la delivery restent hors périmètre.

### AIRun et Knowledge

Tout résultat IA conserve :

- fournisseur, modèle et paramètres ;
- version de prompt et politique ;
- entrée structurée ou empreinte ;
- sources récupérées et claims utilisés ;
- sortie, validation et feedback ;
- coût, latence et statut.

`KnowledgeRetriever` est un port. PostgreSQL est utilisé en premier, pgvector ou
ParadeDB seulement lorsque la recherche hybride devient nécessaire.

## 3. Invariants non négociables

1. Toute donnée métier appartient exactement à un workspace.
2. Une campagne active référence une seule version immuable d’offre et d’ICP.
3. Un contact est unique dans un workspace selon ses identités certaines.
4. Un contact possède au maximum une séquence active par workspace.
5. Une séquence doit être publiée (version immuable valide) avant son
   activation.
6. Toute réponse entrante suspend immédiatement l’automatisation.
7. Une opposition générale bloque tous les canaux.
8. Chaque donnée enrichie conserve source, date, confiance et preuve.
9. Chaque message IA conserve preuves, prompt, modèle, politique et décision.
10. Chaque événement fournisseur est traité idempotemment.
11. Une modification de configuration ne change jamais rétroactivement une
    campagne active.
12. Les analytics distinguent intention, tentative, envoi, livraison, réponse,
    rendez-vous et revenu.

## 4. Événements de domaine

| Événement | Déclencheur | Consommateurs |
|---|---|---|
| `WorkspaceMemberInvited` | invitation créée | notification |
| `OfferVersionPublished` | offre figée | index connaissance |
| `ICPVersionPublished` | ICP figé | recherche/scoring |
| `ProspectDiscovered` | candidat collecté | enrichissement |
| `ContactIdentityVerified` | identité certaine | déduplication |
| `EmploymentChanged` | nouveau poste observé | signaux/campagnes |
| `SignalObserved` | signal entreprise/contact | rescoring |
| `CampaignActivated` | campagne approuvée | enrollment |
| `ApprovalItemApproved`, `ApprovalItemRejected` | décision sur exception autopilote | planification |
| `OutreachActionDue` | délai atteint | exécution |
| `OutreachActionAccepted` | fournisseur accepte | analytics |
| `InboundMessageReceived` | webhook entrant | suspension/classification |
| `SuppressionRegistered` | refus détecté | annulation actions |
| `ReplyDraftApproved` | réponse validée par la politique ou un humain | envoi |
| `MeetingBooked` | calendrier confirmé | pipeline |
| `OpportunityWon` | clôture gagnée | revenu/analytics |

Tous les événements destinés aux workers sont écrits dans l’outbox au sein de
la même transaction que le changement d’état.
