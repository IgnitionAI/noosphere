# Décisions d'architecture produit

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
