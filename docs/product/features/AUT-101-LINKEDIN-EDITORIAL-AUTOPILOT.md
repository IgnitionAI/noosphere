# AUT-101 — Boucle éditoriale LinkedIn quotidienne

## État

Livré et validé en simulation provider le 21 août 2026. Le canary LinkedIn
réel reste le contrat PTC-101 et n'est pas déclenché par cette feature.

## Parcours normal

À l'heure du radar configuré, le worker crée une recherche d'idées durable et
bornée. Le réconciliateur Content réutilise ensuite les primitives existantes :

1. idées sourcées et dédupliquées ;
2. génération checkpointée `brief → writer → evidence audit → critic` ;
3. asset immuable `ready` ou exception localisée `blocked` ;
4. choix d'un créneau conforme aux jours et au budget hebdomadaire ;
5. publication LinkedIn durable avec compte, policy, texte et hash figés ;
6. nouvelle vérification du compte, des claims, de la cadence et du budget à
   la frontière provider.

Aucune validation humaine n'est attendue dans ce chemin. Une erreur sur un
asset est auditée et n'empêche pas les autres assets d'avancer.

## Pause et reprise

`PUT /api/v1/content/autopilot` modifie l'état de manière idempotente. Une
pause annule immédiatement les publications automatiques encore `scheduled`
ou `retry`, sans supprimer les idées, runs, briefs ou versions. À la reprise,
une nouvelle séquence de request key permet de replanifier la même version sans
contourner l'idempotence de la tentative annulée.

## Contrats

- `GET /api/v1/content/autopilot` : état, backlog et exceptions du workspace ;
- `PUT /api/v1/content/autopilot` : activation, heure locale et fuseau IANA ;
- workspace et acteur exclusivement issus de la session ;
- jobs, opérations, outbox et audit tenant-scoped ;
- aucune mutation Content n'appelle directement Unipile depuis le modèle.

## Preuves automatisées

- calcul déterministe des créneaux et collisions ;
- une exception provider ne bloque pas l'asset suivant ;
- permissions viewer/operator ;
- isolation workspace ;
- pause → annulation → reprise → nouvelle planification en PostgreSQL ;
- pipeline Content et publication simulés sans appel réseau provider.
