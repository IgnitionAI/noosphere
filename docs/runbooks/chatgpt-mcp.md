# Piloter Noosphere depuis ChatGPT ou Codex avec MCP

Noosphere expose un serveur MCP Streamable HTTP sur `https://<domaine>/mcp`.
Le serveur est tenant-scoped : le workspace, l'utilisateur, le rôle et les
permissions viennent du jeton OAuth et ne sont jamais acceptés dans les
arguments d'un outil.

## Ce que le serveur permet

Depuis un client MCP, l'utilisateur peut :

- lire l'état du workspace, les offres, études ICP, campagnes, prospects,
  conversations, appels, connaissances et le calendrier éditorial ;
- créer ou enrichir une offre et ses preuves ;
- lancer une étude ICP durable ;
- créer une campagne, configurer le Setter IA et l'autopilote LinkedIn ;
- créer des idées et brouillons, mettre à jour le CRM et le pipeline ;
- répondre à une conversation, proposer un rendez-vous ou publier un contenu
  via le chemin d'effet gouverné ; préparer une activation de campagne dont
  l’adaptateur d’exécution reste indisponible.

Les études, générations et autres travaux longs vivent dans les jobs Noosphere.
Fermer ChatGPT, changer de conversation ou quitter l'interface ne les annule
pas. Leur identifiant d'opération peut être relu avec `operation_get`.

## Prérequis

1. Déployer Noosphere derrière un domaine HTTPS public. `localhost` n'est pas
   joignable depuis un client ChatGPT hébergé.
2. Configurer `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`,
   `MCP_ALLOWED_HOSTS` et `MCP_ALLOWED_ORIGINS` sur la même origine publique.
3. Connecter au moins un fournisseur IA pour les tâches génératives et les
   comptes de canaux nécessaires pour envoyer ou publier réellement.
4. Ajouter `https://<domaine>/mcp` comme serveur MCP dans le client. Noosphere
   annonce son endpoint OAuth et son endpoint d'enregistrement dynamique. Le
   client public est créé sans tenant, puis lié au workspace uniquement après
   connexion et consentement dans Noosphere.

## Connexion dans ChatGPT

La disponibilité dépend du plan ChatGPT et des permissions du workspace. Au
moment de cette documentation, les écritures MCP complètes sont destinées aux
workspaces Business, Enterprise et Edu ; un compte Pro en mode développeur est
limité aux capacités de lecture. Pour une instance locale ou privée qui n'est
pas publiquement joignable, utiliser le tunnel MCP sécurisé proposé par OpenAI
au lieu d'exposer un port de développement sur Internet.

1. Activer le mode développeur dans les paramètres du workspace si le plan le
   requiert.
2. Ouvrir `Paramètres > Apps > Créer` (ou la surface équivalente administrateur).
3. Donner un nom à l'app et saisir uniquement l'URL
   `https://<domaine>/mcp`.
4. Choisir OAuth, puis lancer **Scanner les outils**.
5. Se connecter à Noosphere, choisir le workspace et accepter les scopes
   proposés. Aucun `client_id`, secret ou jeton ne doit être copié à la main :
   l'enregistrement dynamique et PKCE les gèrent.
6. Créer/activer l'app. Dans une conversation ChatGPT, l'ajouter depuis les
   apps ou la mentionner, puis demander par exemple :

   - « Résume mes conversations non lues et propose les trois réponses les plus
     urgentes. »
   - « Lance une étude ICP pour cette offre et donne-moi son état. »
   - « Ajoute cette preuve au knowledge hub, mais ne la valide pas encore. »
   - « Réponds à ce prospect avec le Setter IA. »

ChatGPT peut toujours afficher une confirmation supplémentaire selon sa propre
politique de sécurité. Noosphere ne contourne pas cette protection côté client ;
pour une action explicitement autorisée avec `executeWhenAllowed: true`,
l'owner/admin peut éviter une deuxième approbation Noosphere si ses scopes
l’autorisent, mais la policy métier finale reste obligatoire.

L'enregistrement dynamique accepte uniquement un client public sans secret,
une URI HTTPS exacte (localhost est toléré uniquement pour le développement),
Authorization Code et PKCE S256. Le rôle actif réduit automatiquement les
scopes effectivement accordés.

## Vérifier l'edge avant de connecter un client

```sh
curl --fail --silent --show-error \
  https://noosphere.example.com/.well-known/oauth-protected-resource/mcp
curl --fail --silent --show-error \
  https://noosphere.example.com/.well-known/oauth-authorization-server
```

La ressource annoncée doit être exactement
`https://noosphere.example.com/mcp`. Les métadonnées doivent aussi annoncer
`https://noosphere.example.com/oauth/register`. L'autorisation utilise Authorization Code
avec PKCE S256 ; les access tokens et refresh tokens sont opaques, hachés en
base, révocables et revalidés contre le membership actif du workspace.

## Autonomie et sécurité

- `viewer` : lecture, avec projection sensible réduite ;
- `operator` : lectures et mutations internes, sans approbation d'effet ;
- `reviewer` : décision sur les effets gouvernés ;
- `admin` et `owner` : l'action explicitement demandée au client peut être
  exécutée sans deuxième validation humaine lorsque les trois scopes sont
  présents.

Même pour un owner, l'absence de quota, la suppression, un compte malsain, une
fenêtre d'envoi fermée, un opt-out ou une autre policy bloquante fait échouer
fermement l'action. La préparation crée par défaut une proposition sans
l'exécuter. `executeWhenAllowed: true` doit être fourni explicitement pour
une action externe demandée ; le nom du champ ne remplace pas cette autorisation.

Les outils de lecture sont annotés `readOnlyHint`. Les mutations internes sont
idempotentes. `research_launch` crée un travail durable pouvant appeler un
fournisseur IA. Les réglages du Setter et de l’autopilote peuvent autoriser
des travaux futurs selon la policy du workspace ; ils ne sont pas de simples
brouillons. Les outils de préparation et `approval_decide` ouvrent le chemin
des effets gouvernés, via la policy et les workers durables. L’adaptateur d’activation de campagne reste indisponible : préparer
ou approuver cette intention ne prouve pas le démarrage d’une campagne.

## Validation locale et production-like

- Développement isolé : [mcp-local.md](mcp-local.md)
- Edge OAuth/SDK production-like :
  [mcp-production-smoke.md](mcp-production-smoke.md)

Le smoke de production vérifie le protocole avec le SDK MCP officiel, les
permissions, la révocation, l'isolation inter-workspace et la reprise après
redémarrage. Il ne constitue pas à lui seul une preuve d'envoi vers un provider
réel.
