# ADR-004 — Jobs PostgreSQL et transactional outbox

## Statut
Accepté avec gate d’implémentation.

## Décision
Utiliser un port `JobQueue`, un adaptateur PostgreSQL et une outbox
transactionnelle. La bibliothèque retenue doit réussir le spike Bun.

## Motifs et conséquences
Cette solution évite Redis en V1 et garantit l’atomicité entre état et événement.
La base reçoit aussi la charge des jobs, à surveiller avant montée en charge.

## Date
2026-07-24
