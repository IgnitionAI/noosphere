# ADR-011 — Le Noosphere Axis est une lentille, pas une commande d'exécution

- Statut : accepté
- Date : 2026-08-20
- Décideur : Salim Laimeche
- Validation : expérience et galerie approuvées le 2026-08-20

## Contexte

Noosphere réunit deux moteurs qui peuvent et doivent tourner simultanément :

- Content Inbound crée et capte la demande par les contenus et interactions ;
- Outbound active une demande ciblée par l'ICP, le sourcing et les campagnes.

Un slider linéaire peut suggérer à tort que déplacer le curseur vers Inbound
éteint Outbound, ou qu'il modifie immédiatement un budget et des envois. Cette
ambiguïté serait dangereuse dans un produit autonome.

## Décision

Le `NoosphereAxis` comporte trois positions : `inbound`, `symbiosis` et
`outbound`. Il filtre les projections et change la surface visible. Il ne crée,
ne suspend, ne relance et ne reconfigure aucun job.

- `inbound` montre stratégie, idées, contenus, calendrier et engagement ;
- `symbiosis` montre signaux, attribution, passages vers le CRM et appels ;
- `outbound` montre ICP, sourcing, campagnes, séquences et qualification.

Les deux moteurs continuent selon leurs propres policies. Une modification de
cadence, budget, compte ou autonomie utilise une commande explicite dans
Configuration ou dans le détail de la campagne.

## Conséquences

- la position est sérialisée dans `?lens=inbound|symbiosis|outbound` ;
- le contrôle est un groupe de trois boutons accessible au clavier, stylé comme
  un axe, et non un `input[type=range]` imprécis ;
- aucune route `PATCH` ou commande métier ne correspond au changement de lens ;
- chaque élément transversal porte son moteur source et son attribution ;
- les écrans gardent Prospects, Conversations et Appels communs aux moteurs.

## Alternatives rejetées

### Slider de répartition 0–100

Rejeté en V1 : il expose un faux niveau de contrôle, car un pourcentage ne se
traduit pas directement en contenus, quotas LinkedIn, emails, coût ou appels.

### Deux applications séparées

Rejeté : cela dupliquerait prospects, conversations, configuration, agenda et
attribution, précisément là où Noosphere doit produire sa valeur.

### Un unique dashboard sans perspective

Rejeté : mélanger tous les objets recréerait la surcharge cognitive actuelle.

## Preuve future

Un test E2E doit démontrer que changer trois fois de lens pendant un job actif
ne modifie ni le statut, ni la lease, ni la prochaine action de ce job.
