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

## Flux de branches

Trois branches permanentes, promotion dans un seul sens :

- `dev` : intégration. Tout le travail (features, fixes, docs) est commité ici,
  directement ou via une branche `feat/<description>` fusionnée dans `dev` ;
- `preprod` : validation. On y promeut `dev` quand `bun run check` est vert et
  la QA passée (parcours réel API + base, états, responsive) ;
- `prod` : production. On y promeut `preprod` uniquement pour une release
  validée. `main` reflète `prod`.

Règles : aucun commit direct sur `preprod`/`prod` hors promotion ; un correctif
urgent part de `prod` en `fix/<description>` puis est fusionné dans `prod`,
`preprod` et `dev`.

## Branches et commits

- branche de travail : `feat/<description>`, `fix/<description>` ou
  `docs/<description>`, fusionnée dans `dev` ;
- changements limités à un objectif ;
- aucune donnée personnelle réelle dans les fixtures ;
- aucune clé fournisseur dans le dépôt.

## Pull request

La description doit préciser le problème utilisateur, le contexte borné, les
invariants touchés et les preuves de validation.
