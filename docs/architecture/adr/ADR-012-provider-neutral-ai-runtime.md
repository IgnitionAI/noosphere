# ADR-012 — Runtime IA indépendant du fournisseur

## Statut

Accepté et implémenté le 2026-08-22. Validation locale réussie ; canary produit
VPS encore requis.

## Contexte

Noosphere construit aujourd'hui ses agents autour de `ChatOpenAI` et de
contrats qui imposent souvent `provider="kimi-code"`. L'épuisement du quota Kimi
a bloqué le pipeline de contenu alors que les rendus déterministes, la queue et
les règles métier étaient sains.

Le compte Kimi expose quatre modèles. Un test réel a également confirmé que
Codex CLI peut exécuter `gpt-5.6-luna` avec un effort `xhigh` et produire une
sortie structurée. Ce transport dépend néanmoins de l'authentification et des
limites du plan ChatGPT ; il ne constitue pas un SLA illimité.

## Décision

Introduire un port applicatif `ModelGateway` et une politique `AiRoutingPolicy`.
Les adaptateurs Kimi Chat Completions, Codex CLI et OpenAI Responses implémentent
le même contrat d'inférence structurée.

Un réglage global permet d'appliquer un provider, un modèle et un effort de
raisonnement à toutes les capacités. Une matrice par use case peut ensuite
remplacer librement cette route pour chaque agent avec n'importe quel modèle
découvert chez Kimi ou Codex. Appliquer Kimi globalement choisit K3 par défaut ;
appliquer Codex peut choisir Luna xhigh sans empêcher d'autres modèles Codex.

Les quotas, erreurs d'authentification et modèles indisponibles ouvrent un
circuit et ne sont pas retentés sur le même provider.

Le transport Codex est isolé dans un environnement de service minimal. Il ne
voit ni le dépôt, ni les secrets applicatifs, ni les outils d'envoi.

## Durées de vie et concurrence

Noosphere utilise une composition explicite au démarrage du processus, sans
conteneur d'injection de dépendances. Les durées de vie restent néanmoins
définies :

- **processus** : pool PostgreSQL, repositories, routeur de modèles et gateways
  sans état mutable de conversation ;
- **job** : contexte workspace, policy, historique, deadline, request key et
  trace d'agent ;
- **invocation transitoire** : chaque appel Codex crée son propre répertoire
  temporaire et son propre processus `codex exec --ephemeral`; chaque appel
  Kimi/OpenAI crée sa propre requête HTTP.

Un gateway construit une fois par processus n'est donc pas une session agent
singleton. Aucun historique, prompt, trace d'outils, signal d'annulation ou
répertoire temporaire n'est partagé entre deux jobs.

Les commandes interactives (`conversation.command.execute`) utilisent un pool
de workers dédié. Les générations de contenu et recherches longues ne peuvent
ainsi pas empêcher le polling d'une commande Setter déjà persistée.

## Conséquences positives

- une panne ou un quota fournisseur n'immobilise plus tout Noosphere ;
- les agents métier et leurs tests ne dépendent plus de `ChatOpenAI` ;
- tous les modèles réellement accessibles peuvent être évalués ;
- chaque décision conserve une provenance complète ;
- l'expérience utilisateur reste simple malgré plusieurs transports.

## Coûts et risques

- le transport Codex CLI est expérimental et nécessite une gestion stricte du
  processus, de l'authentification et de la concurrence ;
- les limites ChatGPT/Codex existent et doivent être mesurées ;
- un fallback entre providers peut produire des variations éditoriales ;
- la migration exige une compatibilité temporaire avec les politiques
  recherche/synthèse existantes.

## Alternatives rejetées

### Conserver uniquement Kimi

Rejeté : le quota du fournisseur a déjà interrompu un pipeline autonome.

### Appeler Codex depuis le dépôt applicatif

Rejeté : le client chargerait les instructions, skills, MCP et mémoire du dépôt,
augmenterait fortement les tokens et élargirait inutilement ses accès.

### Utiliser le token ChatGPT comme une clé OpenAI API

Rejeté : ce sont deux surfaces d'authentification distinctes. Le backend API
conventionnel utilise une clé de service ; le transport Codex utilise son client
et son stockage d'authentification dédiés.

### Ajouter un `if provider` dans chaque agent

Rejeté : cela dupliquerait le routage, les retries et la télémétrie dans onze
adaptateurs et recréerait le couplage actuel.

## Validation

- tests unitaires, HTTP, intégration PostgreSQL, architecture et builds : validés ;
- catalogue Kimi live : quatre modèles visibles ;
- catalogue et invocation Codex Luna xhigh avec `CODEX_HOME` minimal : validés ;
- quota Kimi sans retry du même provider et fallback borné : validés par contrat ;
- image Docker Codex CLI non-root et compose combiné : validés ;
- benchmark de 20 dry-runs, redémarrage pendant canary réel et observation sous
  concurrence : requis avant activation en production.

## Spécification associée

Voir `docs/architecture/AI_PROVIDER_ROUTING_V2.md`.
