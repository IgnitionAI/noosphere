# Checklist Guardian

## Avant chaque merge

- [ ] Le changement appartient à un contexte borné identifié.
- [ ] Les règles métier vivent dans le domaine.
- [ ] Le domaine n’importe aucun framework, ORM ou SDK.
- [ ] Les handlers appellent uniquement des cas d’usage.
- [ ] Les cas d’usage reçoivent leurs ports par injection.
- [ ] Chaque changement de schéma met à jour mapper et migration.
- [ ] Toute donnée métier est scoped par `workspace_id`.
- [ ] Les versions actives restent immuables.
- [ ] Les effets externes possèdent une clé d’idempotence.
- [ ] L’outbox est écrite dans la transaction métier.
- [ ] Les suppressions sont vérifiées avant tout envoi.
- [ ] Les logs excluent secrets et contenu personnel par défaut.
- [ ] Tests unitaires sans DB pour le domaine et les cas d’usage.
- [ ] Tests d’intégration PostgreSQL pour repositories et contraintes.
- [ ] Tests contractuels pour Unipile, enrichissement, IA et calendrier.
- [ ] Tests E2E des parcours campagne, réponse et opposition.
- [ ] Le runtime réel des tests et builds est Bun.

## Contrôles CI attendus

1. format et lint ;
2. types TypeScript ;
3. tests unitaires ;
4. guardian des imports ;
5. tests d’intégration PostgreSQL ;
6. vérification des migrations ;
7. tests contractuels sur fixtures ;
8. build web et worker sous Bun ;
9. scan de dépendances et secrets ;
10. E2E critique sur staging.

## Refus automatique de merge

- accès Drizzle hors infrastructure ;
- accès provider depuis le domaine ;
- endpoint permettant de choisir librement un `workspace_id` ;
- mutation d’une version publiée ;
- envoi sans approbation ou sans contrôle de suppression ;
- retry sans idempotence ;
- migration destructive en une seule étape ;
- test unitaire exigeant PostgreSQL ou internet.
