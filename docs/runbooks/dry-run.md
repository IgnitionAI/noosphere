# Runbook dry-run

Toute nouvelle campagne résout `executionMode=dry_run` sauf activation
explicite. La décision K3 et tous les guards tournent normalement, mais un
`send` devient un `approval_item` et l’action passe `awaiting_approval`; aucun
adapter Unipile n’est appelé.

La page de campagne affiche le mode. Le draft reste approuvable uniquement
après activation explicite du mode `live`; une tentative d'approbation en
dry-run échoue sans modifier l'item et sans créer de job de dispatch. Le gate
final relit encore le mode juste avant le provider, de sorte qu'un retour en
dry-run invalide aussi un dispatch déjà placé dans la queue. Le changement de
mode n'altère pas l'historique.

Pour vérifier sans réseau :

```bash
bun test tests/unit/prospect-decision-policy.test.ts
bun run test:integration
```

Le scénario V3 affirme qu’aucun job de dispatch n’existe en dry-run, exige le
passage explicite en live avant approbation et utilise un faux gateway pour
l’envoi.
