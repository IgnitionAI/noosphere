# Frontière de preuve et d’enrichissement

Ce lot n’ajoute pas un second ledger. L’équivalent utile existait déjà :

- `enrichment_observations` conserve entité, champ, valeur, source, URL,
  extrait, confiance, vérification, date et déduplication;
- `contact_identities` distingue la source et le statut de vérification;
- `knowledge_sources`/claims relient les contenus générés aux connaissances
  autorisées;
- le contenu personnalisé conserve les métadonnées de génération et les
  preuves publiques du candidat.

Le modèle d’enrichissement écrit des observations, pas directement les champs
canoniques. Une adresse probable ne devient pas une identité; les tests
`enrichment.test.ts` couvrent cette protection. Une identité saisie par une
personne n’est donc jamais silencieusement écrasée. Les doublons sont bloqués
par les clés tenant-scoped. Les contradictions et valeurs faibles restent des
observations à examiner.

Un ledger suggestion/applied/rejected séparé ne devient justifié que si le
produit autorise un jour la promotion automatique de champs CRM arbitraires.
Ce n’est pas le cas de ce lot et l’ajouter aurait dupliqué l’enrichissement.
