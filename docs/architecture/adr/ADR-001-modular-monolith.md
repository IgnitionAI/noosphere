# ADR-001 — Monolithe modulaire

## Statut
Accepté.

## Décision
Déployer une application web et un worker issus d’un même monorepo et partageant
un domaine modulaire. Aucun microservice en V1.

## Motifs et conséquences
Une équipe solo et le volume attendu favorisent les transactions simples et un
coût opérationnel faible. Les ports et contextes permettent une extraction
future. Le principal risque est le couplage interne, contrôlé par le Guardian.

## Alternatives rejetées
Microservices, trop coûteux à exploiter ; monolithe non structuré, trop exposé à
la dérive.

## Date
2026-07-24
