# Quality gates des features

## Definition of Ready

Une feature peut entrer en développement si :

- son identifiant, sa valeur et son rôle utilisateur sont définis ;
- son périmètre et son hors-périmètre sont explicites ;
- ses dépendances sont disponibles ou planifiées avant elle ;
- ses critères d’acceptation décrivent des résultats observables ;
- les états loading, empty, error, forbidden et provider-down sont précisés ;
- les permissions par rôle sont connues ;
- les invariants workspace, suppression et idempotence applicables sont listés ;
- les routes UI, endpoints et événements à ajouter sont identifiés ;
- les migrations et données personnelles concernées sont connues ;
- aucun choix produit bloquant n’est laissé à l’implémentation.

## Definition of Done

Une feature est terminée si :

- le parcours complet est utilisable avec des données réalistes ;
- les critères d’acceptation sont couverts par des tests adaptés ;
- les tests d’isolation workspace passent ;
- les permissions sont vérifiées côté serveur ;
- les mutations sensibles sont auditées ;
- les opérations externes et jobs sont idempotents ;
- les états d’interface et le responsive sont vérifiés ;
- les erreurs fournisseur sont récupérables et observables ;
- les événements analytics nécessaires sont émis une seule fois ;
- migrations, rollback logique et runbook sont documentés ;
- contrats API et documentation produit sont à jour ;
- aucune donnée sensible ou secret n’apparaît dans les logs.

## Tests transverses obligatoires

| Risque | Test minimal |
|---|---|
| fuite tenant | mêmes identifiants métier dans deux workspaces |
| double livraison | même webhook/job traité deux fois |
| course réponse/envoi | réponse persistée pendant qu’une action devient due |
| suppression tardive | suppression créée après planification, avant envoi |
| version mutable | tentative de modifier une version utilisée |
| compte indisponible | dégradation d’un compte sans bloquer les autres |
| permission | appel direct API malgré action masquée dans l’UI |
| données fournisseur | payload partiel, retardé, invalide et relivré |

## Critères frontend communs

- navigation clavier et focus visible ;
- labels et erreurs de formulaire explicites ;
- skeleton de dimensions stables ;
- table paginée sans charger tout le workspace ;
- action principale évidente sur chaque empty state ;
- date, fuseau, montant, statut de source et confiance non ambigus ;
- confirmation renforcée pour suppression, merge, activation et envoi ;
- tests visuels à 375, 768, 1024 et 1440 px.
