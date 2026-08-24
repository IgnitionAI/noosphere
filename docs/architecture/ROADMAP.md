# Roadmap Noosphere

> Statut : vue produit au 24 août 2026. L'AS-IS technique est dans
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) et la boucle simple dans
> [`../product/SIMPLE_LOOP.md`](../product/SIMPLE_LOOP.md).

## Boucle présente dans le code

1. **ICP** — lecture produit, recherche sourcée, audit adversarial et
   publication automatique des ICP valides.
2. **Outbound** — campagnes mono-canal, sourcing adapté à LinkedIn ou à
   l'entreprise, enrichissement, scoring, personnalisation, envoi et relance.
3. **Content Inbound LinkedIn** — stratégie, idées sourcées, texte/images/
   documents, calendrier, publication durable, interactions et attribution.
4. **Conversations** — miroir LinkedIn, email et WhatsApp, amélioration IA,
   Setter durable, reprise humaine et distinction campagne/hors campagne.
5. **Prospect 360** — mémoire relationnelle centrale, context receipts et
   reconstruction par invocation.
6. **Appels** — créneaux, réservation idempotente, historique, opportunité et
   origine Inbound/Outbound/mixte/inconnue.
7. **Knowledge** — extraction locale PDF/Office, Qwen/ParadeDB et recherche
   hybride versionnée.

Le chemin normal ne contient aucune approbation. Suppressions, quotas,
fenêtres, comptes dégradés et sujets sensibles restent des arrêts déterministes
localisés.

## Gates avant déploiement VPS

- exécuter la suite complète PostgreSQL, crawler et web ;
- rejouer les migrations et restaurer un backup sur une instance vierge ;
- mesurer extraction documentaire, TEI, crawl et campagnes concurrentes sur le
  VPS cible ;
- vérifier Unipile, webhooks, backfill Inbox et reprise après redémarrage ;
- exécuter les Product Truth canaries bornés ICP, Inbox/Setter et LinkedIn
  Content ;
- réserver puis annuler un appel de test ;
- observer les jobs, dead letters, tentatives provider inconnues et mémoire
  pendant une fenêtre prolongée.

## Prochains lots après canary LinkedIn

Ordre recommandé :

1. stabiliser la preuve réelle LinkedIn texte/image/document et l'attribution ;
2. améliorer qualité éditoriale, expérimentation de formats et métriques ;
3. créer la primitive « longue vidéo vers Shorts » ;
4. ajouter un seul nouveau canal social par tracer bullet ;
5. ne choisir X, YouTube ou TikTok qu'après validation de ses capacités,
   policies, coût et Product Truth Contract.

Chaque canal réutilise offre, ICP, brand kit, Knowledge, CRM, conversations et
attribution. Il reçoit néanmoins ses propres assets, contraintes et snapshots ;
un post LinkedIn n'est jamais recopié aveuglément.

## Apprentissage produit

Après les premiers appels réels :

- suivre découverte, délivrabilité, réponse, qualification et booking par ICP,
  canal et contenu ;
- distinguer causalité prouvée, attribution probable et origine inconnue ;
- ajuster cadence et budgets dans les limites explicites de la policy ;
- utiliser les faits Prospect 360 pour éviter répétitions et contradictions ;
- n'élargir ni ICP, ni claim, ni canal automatiquement sans décision produit.

## Hors chemin normal

- éditeur de workflow arbitraire ;
- warmup email maison ;
- facturation, devis, contrats et delivery client ;
- génération vidéo longue générique ;
- OCR ou analyse vision implicite ;
- publication d'une affirmation factuelle non sourcée ;
- réponse automatique implicite hors campagne ;
- accès direct du modèle à un provider, une base ou un secret.
