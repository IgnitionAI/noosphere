# ADR-008 — Séparer authentification et workspace

## Statut
Accepté.

## Décision
Better Auth gère utilisateurs, sessions et méthodes de connexion. Le domaine
gère Workspace, Membership, invitations, rôles et autorisations.

## Motifs et conséquences
Le cœur multi-tenant ne dépend pas du modèle d’organisation d’un fournisseur
d’auth. Une projection fiable entre utilisateur d’auth et membership est
nécessaire.

## Date
2026-07-24
