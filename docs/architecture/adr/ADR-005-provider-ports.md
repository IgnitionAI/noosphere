# ADR-005 — Fournisseurs derrière des ports

## Statut
Accepté.

## Décision
Unipile implémente `CommunicationChannel`; la recherche, l’enrichissement email,
le calendrier, l’IA et le stockage ont chacun leur port dédié.

## Motifs et conséquences
Le domaine exprime prospecter, envoyer et enrichir, jamais appeler un endpoint
fournisseur. Les adaptateurs demandent des tests contractuels et une
normalisation explicite des statuts.

## Date
2026-07-24
