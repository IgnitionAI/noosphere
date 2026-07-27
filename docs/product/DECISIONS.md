# Décisions d'architecture produit

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
