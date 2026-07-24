# Contribuer

## Avant de modifier

1. Lire `docs/architecture/ARCHITECTURE_CONTRACT.md`.
2. Identifier le contexte métier concerné.
3. Vérifier les invariants dans `docs/architecture/DOMAIN.md`.
4. Comparer l’interface au prototype dans `prototype/`.

## Validation

```bash
bun run check
```

Lors de l’implémentation Next.js, ajouter progressivement types, tests
unitaires, tests PostgreSQL, contrats fournisseurs et tests visuels.

## Branches et commits

- branche : `feat/<description>`, `fix/<description>` ou `docs/<description>` ;
- changements limités à un objectif ;
- aucune donnée personnelle réelle dans les fixtures ;
- aucune clé fournisseur dans le dépôt.

## Pull request

La description doit préciser le problème utilisateur, le contexte borné, les
invariants touchés et les preuves de validation.
