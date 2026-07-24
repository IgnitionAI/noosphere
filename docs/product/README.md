# Préparation produit

Ce dossier transforme l’architecture et le prototype d’Ignition Outbound en
backlog d’implémentation.

## Documents

- [Catalogue des features](FEATURE_CATALOG.md)
- [Plan de livraison](DELIVERY_PLAN.md)
- [Frontière IA](AI_BOUNDARY.md)
- [Matrice de traçabilité](TRACEABILITY_MATRIX.md)
- [Definition of Ready et Definition of Done](QUALITY_GATES.md)
- [Modèle de fiche feature](FEATURE_TEMPLATE.md)

## Règle de lecture

Une feature est prête à être développée lorsqu’elle possède :

1. une valeur utilisateur observable ;
2. un périmètre et un hors-périmètre explicites ;
3. des critères d’acceptation testables ;
4. ses dépendances fonctionnelles et techniques ;
5. les routes, cas d’usage et événements concernés ;
6. les exigences d’isolation workspace, d’audit et d’idempotence applicables.

Le catalogue est la source produit. Les documents sous `docs/architecture/`
restent la source normative pour les invariants techniques et métier.
