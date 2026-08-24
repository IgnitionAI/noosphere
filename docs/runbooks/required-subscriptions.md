# Abonnements et comptes externes nécessaires

Vérifié le : 2026-08-24

Portée : déploiement VPS de Noosphere

Noosphere auto-héberge PostgreSQL/ParadeDB, MinIO, SearXNG, le crawler, Qwen
Embedding et le reranker BGE. Ces composants ne nécessitent aucun abonnement
API. Le VPS, les canaux de communication et au moins une route IA restent à la
charge de l'opérateur.

## Résumé

| Besoin | Nécessaire ? | Compte ou abonnement |
|---|---|---|
| Héberger Noosphere | oui | VPS et nom de domaine |
| LinkedIn, email ou WhatsApp | oui pour ces canaux | Unipile + comptes réels à associer |
| Raisonnement et rédaction IA | oui | **Codex ou Kimi** ; les deux sont optionnels si l'autre fonctionne |
| Embeddings et reranking | non | Qwen et BGE sont auto-hébergés via TEI |
| Recherche web | non | SearXNG et crawler sont auto-hébergés |
| Stockage S3 | non | MinIO est auto-hébergé |
| OCR | non disponible | aucun abonnement ; les scans passent `ocr_required` |
| OpenAI API | non par défaut | seulement si une route `openai-api` est volontairement activée |

## 1. Unipile

### Pourquoi il est requis

L'implémentation actuelle utilise Unipile pour associer et piloter :

- les profils LinkedIn utilisés par le sourcing, l'outreach, l'inbox et le
  Content Inbound LinkedIn ;
- les boîtes email synchronisées et utilisées pour les campagnes ;
- les numéros WhatsApp synchronisés et utilisés pour les conversations.

Noosphere ne crée pas ces identités : chaque profil LinkedIn, boîte email et
numéro WhatsApp doit exister et être connecté au workspace.

### Facturation à prévoir

Unipile facture le nombre maximal d'**identités liées simultanément** pendant la
période : un profil LinkedIn, une adresse email et un numéro WhatsApp comptent
chacun comme un compte lié. Au 2026-08-24, la page officielle annonce :

- minimum de 49 EUR par mois hors TVA jusqu'à 10 comptes liés ;
- essai de 7 jours sans carte ;
- appels API inclus, mais les quotas et règles propres à LinkedIn, Gmail ou
  WhatsApp continuent de s'appliquer.

Exemple interne : 1 LinkedIn + 1 email + 1 WhatsApp = 3 comptes liés, donc dans
le minimum « jusqu'à 10 » à la date de vérification. Toujours revérifier les
[tarifs officiels Unipile](https://www.unipile.com/pricing-api/) avant achat.

### Configuration Noosphere

```dotenv
UNIPILE_DSN=https://apiXX.unipile.com:PORT
UNIPILE_API_KEY=...
UNIPILE_WEBHOOK_SECRET=...
UNIPILE_INBOX_SYNC_ENABLED=true
UNIPILE_SOCIAL_CONTENT_SYNC_ENABLED=true
UNIPILE_SOCIAL_ENGAGEMENT_SYNC_ENABLED=true
```

Les comptes doivent ensuite être associés depuis **Configuration → Canaux**.
Les variables `UNIPILE_LINKEDIN_ACCOUNT_ID` et
`UNIPILE_WHATSAPP_ACCOUNT_ID` servent de valeurs opératoires initiales ; la
source de vérité multi-workspace reste `connected_accounts` et
`workspace_channel_accounts`.

Le webhook public doit résoudre vers :

```text
https://<PUBLIC_HOST>/api/v1/webhooks/unipile
```

### Gate avant activation

- API key valide et DSN de la bonne instance ;
- compte visible dans le workspace, état `connected` et healthcheck sain ;
- webhook authentifié reçu ;
- backfill Inbox terminé ou en progression durable ;
- limites quotidiennes Noosphere inférieures aux limites du provider ;
- canary sans effet, puis un effet réel borné et explicitement autorisé.

## 2. IA : choisir Codex ou Kimi

Noosphere nécessite au moins **une route IA saine**. Il n'est pas nécessaire de
payer Codex et Kimi en même temps. Configurer les deux apporte un fallback mais
additionne les abonnements et ne double jamais l'autorité d'envoi.

### Option A — Codex CLI

Le runtime lance un processus Codex éphémère par invocation structurée. Il
utilise un `CODEX_HOME` de service persistant uniquement pour
l'authentification ; le répertoire de travail et le contexte du job sont
temporaires. Aucun agent ou transcript n'est conservé en singleton.

OpenAI indique que Codex est inclus dans les plans ChatGPT, avec des limites
variables selon le plan. Pour l'instance interne, il faut donc un compte ChatGPT
ayant accès au modèle choisi et assez de quota. Les offres et limites changent :
consulter la page officielle [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).

Configuration :

```dotenv
AI_PROVIDER=codex-cli
CODEX_DEFAULT_MODEL=gpt-5.6-luna
CODEX_DEFAULT_REASONING_EFFORT=xhigh
CODEX_BINARY_PATH=codex
```

Après le premier démarrage du VPS :

```bash
docker compose -f compose.infrastructure.yml -f compose.production.yml \
  --profile codex-auth run --rm codex-auth
```

Le device login est conservé dans le volume privé `codex-service-home`.
`OPENAI_API_KEY` n'est pas nécessaire pour cette option.

Attention : une authentification ChatGPT personnelle convient au canary interne
mais ne constitue pas à elle seule un SLA de backend multi-client. Avant de
vendre Noosphere ou d'augmenter fortement la concurrence, valider les termes,
la rétention, les quotas et le plan Business/Enterprise ou basculer vers une
API de service appropriée.

### Option B — Kimi Code

L'adaptateur actuel attend une clé **Kimi Code**, pas une clé Moonshot/Kimi Open
Platform :

```dotenv
AI_PROVIDER=kimi-code
KIMI_CODE_API_KEY=...
KIMI_CODE_BASE_URL=https://api.kimi.com/coding/v1
```

La clé est créée dans la console Kimi Code et consomme le quota de l'abonnement
Kimi. La documentation Kimi précise que les clés et quotas sont partagés entre
clients et que l'endpoint OpenAI-compatible est
`https://api.kimi.com/coding/v1`. Voir le
[guide officiel Kimi Code](https://www.kimi.com/en/help/kimi-code/membership-guide).

Le catalogue est découvert dynamiquement par `/models`. Les identifiants de
secours présents dans la configuration ne garantissent pas que le compte y a
accès. Le mode HighSpeed peut exiger un plan supérieur et consomme davantage de
quota ; l'interface doit montrer l'état réel du catalogue.

Attention contractuelle : Kimi présente Kimi Code comme un service destiné aux
scénarios de coding et recommande Kimi Open Platform pour l'intégration produit
et le travail d'équipe. L'instance interne peut utiliser la route Kimi Code
testée, mais une commercialisation multi-workspace doit confirmer cet usage
avec Kimi ou faire évoluer l'adaptateur vers la plateforme produit. Les clés et
Base URLs des deux plateformes ne sont pas interchangeables.

### Option C — les deux, avec fallback

Configurer `KIMI_CODE_API_KEY` **et** authentifier le volume Codex rend les deux
catalogues disponibles. La page **Configuration → IA** choisit provider,
modèle et effort par capacité. Chaque stage est rejoué depuis son snapshot sur
fallback ; aucun raisonnement caché ni effet externe ne traverse les providers.

Recommandation pour l'instance interne :

```text
principal : Codex CLI
fallback  : Kimi Code
```

Cette recommandation n'est valide que si les deux comptes ont du quota et si
leur profil de traitement est compatible avec les données du workspace.

## 3. Ce qui n'est plus requis

- aucune clé OpenAI pour les embeddings ;
- aucun abonnement Pinecone ou autre base vectorielle ;
- aucun service Docling ;
- aucune API Tavily ;
- aucun S3 managé pour le chemin standard ;
- aucun Redis, Kafka ou service de queue externe.

## 4. Checklist d'achat pour un workspace léger

- [ ] VPS x86_64 avec 16 Gio de RAM minimum acceptable ;
- [ ] nom de domaine et DNS ;
- [ ] abonnement Unipile ;
- [ ] au moins un profil LinkedIn réel ;
- [ ] une boîte email réelle si le canal email est activé ;
- [ ] un numéro WhatsApp réel si le canal WhatsApp est activé ;
- [ ] un compte **Codex ou Kimi** avec quota disponible ;
- [ ] URL de réservation ou connexion calendrier ;
- [ ] sauvegarde chiffrée hors VPS.

Les tarifs externes sont temporels. Cette page conserve une date de
vérification et des liens officiels ; elle ne doit jamais être utilisée comme
devis contractuel.
