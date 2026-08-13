# Traitement des réponses et priorité sur les relances

À l’ingestion d’un webhook authentifié, `UnipileWebhookIngestor` déduplique
l’événement, le persiste et crée le job de classification dans la même
transaction. S’il s’agit d’un inbound rattachable, cette transaction prend un
advisory lock contact, annule l’enrollment, les actions `scheduled`,
`awaiting_approval` ou `executing`, et les décisions encore actives. Un outbox
event documente l’invalidation.

`OutreachDispatchJobProcessor` prend le même lock juste avant de créer la
tentative et d’appeler le provider. Il relit action, enrollment, campagne et
contact. Une réponse ingérée pendant la préparation rend donc le gate faux et
aucun appel externe n’a lieu. La clé d’idempotence provider protège la
frontière réseau restante.

Le job inbound persiste ensuite conversation et message, puis applique les
règles prioritaires avant K3 : unsubscribe, bounce, absence/auto-reply,
`NOT_NOW`, mauvais contact et referral. Ces décisions structurées contiennent
preuve, `resumeAt`, referral, handoff et prochaine action. Les autres réponses
sont classées par le Setter K3 avec schéma Zod.

- unsubscribe : suppression globale;
- bounce : suppression du canal et email marqué invalide;
- absence/NOT_NOW : reprise datée via une nouvelle décision durable;
- wrong person/referral : handoff avec provenance, sans création silencieuse;
- intérêt/meeting : handoff et opportunité existante mise à jour;
- duplicate webhook : aucun second message, job ou effet.
