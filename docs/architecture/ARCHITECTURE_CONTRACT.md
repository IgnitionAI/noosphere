# Contrat d'architecture Noosphere

> Statut : **normatif**, vérifié le 24 août 2026. Toute implémentation qui le
> viole doit être corrigée avant merge ou accompagnée d'un ADR accepté.

## 1. Forme du système

Noosphere est un monolithe modulaire Bun/TypeScript avec plusieurs processus de
déploiement et un crawler Python isolé :

```text
apps/
  web/                 # Next.js, composition UI et proxy HTTP
  api/                 # composition root HTTP
  worker/              # même moteur, rôles général/decision/setter/memory
  crawler/             # FastAPI + Crawl4AI, réseau privé
packages/
  domain/              # règles et types métier purs
  application/         # cas d'usage, DTO et ports
  infrastructure/      # Drizzle, queue, stockage, providers, IA
  interface/           # handlers, validation et sérialisation
  contracts/           # schémas HTTP/événements et OpenAPI
```

Les sous-domaines actuels sont Workspace, GTM/ICP, CRM, Campaigns, Content,
Pipeline, Knowledge, AI, Operations et Prospect Memory. Une fonctionnalité
traverse les couches ; elle ne crée pas un dossier vertical mélangeant UI, SQL
et provider.

## 2. Sens des dépendances

- `domain` utilise le standard TypeScript uniquement ;
- `application` dépend du domaine et de contrats internes, jamais de
  l'infrastructure ou de Next.js ;
- `infrastructure` implémente les ports et possède Drizzle, SDK et clients ;
- `interface` traduit HTTP/événements vers les cas d'usage ;
- `apps/*` compose les dépendances et démarre les processus.

Imports interdits dans `domain` : React, Next.js, Better Auth, Drizzle, `pg`,
SDK provider, LangChain, Zod, queue et stockage.

## 3. Portée et identité

1. Le workspace et l'utilisateur proviennent de la session ou d'un principal
   technique authentifié, jamais d'un `workspaceId` librement choisi par le
   client.
2. Toute lecture et mutation métier est scoped par workspace.
3. Toute relation inter-table qui pourrait franchir un tenant est vérifiée au
   repository ou par une contrainte adaptée.
4. Les événements provider sont résolus vers un compte connecté avant leur
   rattachement à un workspace.
5. Les logs ne contiennent ni secret, ni token, ni contenu personnel brut par
   défaut.

## 4. Durabilité et effets externes

1. Une commande longue crée d'abord un état durable et un job.
2. Une mutation métier et son événement outbox partagent une transaction.
3. Les workers réservent par lease, renouvellent si nécessaire et tolèrent une
   double livraison.
4. Tout effet provider possède une `requestKey` stable et un attempt durable.
5. Un résultat provider ambigu devient `unknown`/`reconciling`, jamais un
   nouvel envoi aveugle.
6. Fermer l'UI ne modifie ni job, ni lease, ni prochaine action.
7. Les snapshots publiés ou envoyés sont immuables ; une nouvelle version est
   requise pour changer leur contenu.

## 5. IA et durée de vie

- Un agent LangChain/Deep Agent ou un processus Codex est créé pour une
  invocation bornée et détruit ensuite.
- Les clients d'infrastructure sans état peuvent vivre pendant le processus ;
  aucun agent singleton ne conserve transcript, workspace ou prospect.
- Le contexte est reconstruit depuis PostgreSQL : offre, ICP, preuves,
  mémoire Prospect 360, messages récents, policy et objectif de l'étape.
- Le modèle propose une sortie structurée. La policy déterministe autorise ou
  refuse l'effet externe immédiatement avant son exécution.
- Le modèle ne reçoit jamais de credential provider et ne touche jamais
  directement Unipile, Google Calendar, MinIO ou PostgreSQL.
- Modèle, prompt, policy, preuves, coût, latence et correlation ID sont
  auditables.

## 6. Prospect 360

La mémoire d'un prospect est un agrégat durable, pas un cache de conversation.
Elle peut synthétiser les faits confirmés, objections, engagements, préférences,
prochaine action et éléments à ne pas répéter. Chaque fait sensible garde sa
provenance. Une synthèse n'efface jamais les événements bruts.

Les nouvelles invocations reçoivent la mémoire utile et une fenêtre récente du
thread. Elles ne réutilisent pas une ancienne instance d'agent.

## 7. Connaissance et recherche

1. Les fichiers sont stockés dans MinIO et extraits localement selon leur MIME.
2. PDF texte, DOCX, PPTX, XLSX, HTML, Markdown et texte sont supportés.
3. Aucun OCR ni Docling n'appartient au runtime standard.
4. Un document `ocr_required` produit zéro chunk et zéro preuve.
5. Les chunks gardent une provenance résoluble page/slide/feuille/section.
6. Qwen3 Embedding 0.6B, 1 024 dimensions, est l'unique révision active
   initiale ; aucun fallback OpenAI Embeddings.
7. ParadeDB BM25 et pgvector sont fusionnés par RRF puis rerankés par BGE.
8. Une migration de modèle future est blue-green ; une recherche ne mélange
   jamais les scores de deux révisions.

## 8. Ports obligatoires

Les noms exacts peuvent évoluer avec le domaine, mais les frontières suivantes
restent obligatoires :

- sourcing et lecture web/sociale ;
- enrichissement de contacts ;
- communication LinkedIn, email et WhatsApp ;
- publication et lecture de contenu social ;
- calendrier ;
- modèle IA et agent executor ;
- recherche de connaissance et embedding/reranking ;
- stockage objet ;
- queue/outbox ;
- horloge et identifiants.

Le domaine ne branche jamais sur `provider === "unipile"`. La sélection et les
capacités appartiennent à l'application ou à l'infrastructure.

## 9. Autonomie et sécurité métier

- Le chemin normal Outbound et Content Inbound ne requiert pas d'approbation
  humaine.
- L'utilisateur peut reprendre la main, suspendre une ressource ou envoyer un
  message manuel.
- Suppression, opt-out, quota, fenêtre horaire, compte sain, claim autorisé et
  policy sont revérifiés avant tout effet.
- Demande de prix, négociation, juridique, sécurité, opt-out ou volonté de
  parler à un humain déclenche une exception locale.
- Une réaction sociale seule ne déclenche pas un DM automatique.
- Une conversation hors campagne n'est jamais automatisée implicitement.

## 10. Changement de topologie

Un nouveau microservice exige au moins une propriété opérationnelle ou une
contrainte de runtime réellement distincte. Les exceptions actuelles sont le
crawler Python et les serveurs TEI. Redis, une base par tenant, un CQRS séparé
ou un autre langage ne sont ajoutés qu'après une mesure et un ADR.

## 11. Validation requise

- graphe d'import sans cycle interdit ;
- domaine testable sans DB, réseau ni variables d'environnement ;
- repositories testés contre PostgreSQL réel ;
- isolation inter-workspace ;
- double livraison webhook/job ;
- course réponse entrante contre envoi planifié ;
- suppression créée entre planification et exécution ;
- fermeture d'écran pendant un job ;
- contrats provider sur fixtures et canary borné avant production ;
- compatibilité Bun de chaque SDK serveur ;
- Product Truth Contracts concernés rejoués.
