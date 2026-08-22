# AUT-101 — Boucle éditoriale LinkedIn quotidienne

## État

Livré et validé en simulation provider le 21 août 2026. Le préflight réel du
22 août 2026 confirme le compte LinkedIn connecté, la capacité de publication
texte et la chaîne sourcée jusqu'au hash exact, sans effet provider. Le canary
LinkedIn L4 reste le contrat PTC-101 et n'est pas déclenché par cette feature.

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

## Cadence configurable

La configuration opérationnelle accepte un ou deux créneaux par jour et les
jours ISO 1 à 7. Le réglage retenu pour le workspace IgnitionAI est `09:00` et
`17:00`, tous les jours, soit au plus 14 publications par semaine lorsque le
stock de contenus `ready` le permet. Ce plafond opérationnel ne modifie pas la
stratégie éditoriale immuable.

Un changement de jours ou d'heures annule les publications automatiques encore
en attente, puis les replanifie avec une nouvelle request key. À la frontière
provider, l'exécuteur relit la configuration active et revérifie le jour,
l'heure et le budget hebdomadaire. Une cadence mise en pause ou modifiée ne
peut donc pas laisser partir un ancien créneau.

## Qualité éditoriale et sérialisation

Une seule génération Content est lancée à la fois par workspace. Les assets
déjà `ready` peuvent continuer vers leur créneau, mais le writer ne reçoit pas
plusieurs idées en parallèle : chaque nouveau post peut ainsi tenir compte des
versions `ready` encore non publiées, en plus des publications passées.

Une amélioration de texte ne reconstruit plus le brief déjà validé. Le brief
immuable est réutilisé uniquement si l'idée, la stratégie et chacun des hashes
de preuves référencés sont toujours identiques. Au moindre écart, le pipeline
repart du brief. Cette reprise supprime un appel Kimi sans réduire le contrôle
éditorial ni factuel.

La policy déterministe `linkedin-editorial-v2` complète le writer et le critic :

- un seul angle, un seul appel à l'action et au plus une question ;
- 1 500 caractères maximum ;
- aucune narration visible du registre de preuves ou du travail d'audit ;
- blocage des formulations génériques et des variantes trop proches de
  l'historique récent ;
- un fait non résolu reste une exception et ne devient jamais une affirmation.

Le writer `noosphere-content-writer-v3` adapte aussi la longueur à la densité
des preuves. Il préfère un post plus court à un mécanisme supposé, un résultat
implicite ou du remplissage éditorial.

Dans un run, un rejet réparable n'est plus immédiatement transformé en
exception :

1. l'auditeur peut demander jusqu'à deux suppressions ou resserrages, y compris
   pour un sujet interdit ou une capacité non sourcée ;
2. le critique peut demander jusqu'à deux réécritures éditoriales ;
3. toute réécriture repasse obligatoirement par l'audit et le critique ;
4. après épuisement du budget, l'asset reste `blocked` et ne peut pas être
   publié.

Les anciennes versions `ready` qui ne portent pas cette policy ne peuvent pas
être planifiées. Elles passent d'abord par une amélioration immuable. Les
réparations ont priorité sur les nouvelles idées et sont bornées à deux
tentatives par asset et par version de policy ; un échec persistant reste une
exception localisée au lieu de créer une boucle infinie.

## Pause et reprise

`PUT /api/v1/content/autopilot` modifie l'état de manière idempotente. Une
pause annule immédiatement les publications automatiques encore `scheduled`
ou `retry`, sans supprimer les idées, runs, briefs ou versions. À la reprise,
une nouvelle séquence de request key permet de replanifier la même version sans
contourner l'idempotence de la tentative annulée.

## Contrats

- `GET /api/v1/content/autopilot` : état, backlog et exceptions du workspace ;
- `PUT /api/v1/content/autopilot` : activation, radar, fuseau IANA, un ou deux
  créneaux de publication et jours actifs ;
- workspace et acteur exclusivement issus de la session ;
- jobs, opérations, outbox et audit tenant-scoped ;
- aucune mutation Content n'appelle directement Unipile depuis le modèle.

## Preuves automatisées

- calcul déterministe des créneaux et collisions ;
- une exception provider ne bloque pas l'asset suivant ;
- permissions viewer/operator ;
- isolation workspace ;
- pause → annulation → reprise → nouvelle planification en PostgreSQL ;
- cadence opérationnelle deux fois par jour acceptée par le garde-fou final,
  même lorsque la stratégie éditoriale d'origine était limitée à trois jours ;
- une seule génération active par workspace et priorité aux réparations ;
- réutilisation du brief sur amélioration et invalidation dès qu'un hash de
  preuve change ;
- historique incluant les versions prêtes mais pas encore publiées ;
- migration éditoriale des anciens assets avant toute planification ;
- blocage déterministe des répétitions, textes trop longs et langage d'audit ;
- pipeline Content et publication simulés sans appel réseau provider.
- canary Kimi réel du 22 août 2026 : premier draft refusé, réécrit, réaudité
  puis finalisé `ready` ; aucune `content_publication` créée et autopilote resté
  en pause.
- préflight Unipile réel du 22 août 2026 : compte sélectionné identique au
  compte observé, statut `connected`, publication texte disponible, hash exact
  et rapport expurgé ; aucune planification ni publication créée.
