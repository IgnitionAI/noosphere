# Capacité Noosphere — stack standard du 21 août 2026

## Verdict

La cible de départ recommandée est un **Netcup RS 2000 G12** : 8 cœurs AMD
EPYC dédiés, 16 Gio de RAM et 512 Go NVMe. Au 21 août 2026, Netcup l'affiche
à partir de 21,43 € TTC/mois. Le VPS 2000 G12 fournit les mêmes quantités de
vCPU, RAM et NVMe à partir de 19,25 € TTC/mois, mais sans garantie de CPU
dédié. L'écart de prix est trop faible pour accepter une contention CPU sur
PostgreSQL et Chromium.

Sources fournisseur consultées le 21 août 2026 :

- [Root Server G12 Netcup](https://www.netcup.com/en/server/root-server) ;
- [VPS G12 Netcup](https://www.netcup.com/en/server/vps).

Ce verdict remplace la recommandation de la baseline du 11 août pour la
topologie standard. Docling n'est plus inclus dans cette topologie.

## Environnement mesuré

| Élément | Valeur |
|---|---|
| Machine hôte | Apple M4, 10 cœurs, 16 Gio RAM |
| OS | macOS 26.5.2 arm64 |
| Docker Desktop | 10 CPU, 7,654 Gio RAM |
| Runtime | Bun 1.3.4, Next.js 16.2.11 standalone |
| Services | API, web, 2 workers, ParadeDB, MinIO, SearXNG, crawler |
| Services exclus | proxy public, backups, Docling |
| Workspace | `ignition-ai` |
| Données du workspace | 5 937 contacts, 13 campagnes, 6 697 conversations, 38 986 messages |
| Inbound persistant | 0 idée, 0 asset, 0 publication au moment du test |

La machine exécutait d'autres conteneurs IgnitionAI. Les métriques sont
filtrées aux huit conteneurs Noosphere ; une contention hôte résiduelle reste
possible. Docker Desktop arm64 ne reproduit pas exactement Docker Engine
x86_64 sur AMD EPYC.

## Protocole reproductible

La topologie est exposée uniquement sur loopback par
`compose.benchmark.yml`. Aucun secret n'est écrit dans le rapport JSON.

```bash
PUBLIC_HOST=localhost BACKUP_DIR=/tmp/noosphere-benchmark-backups \
docker compose --env-file .env \
  -f compose.infrastructure.yml \
  -f compose.production.yml \
  -f compose.benchmark.yml \
  up -d --build --wait \
  database minio minio-init searxng crawler migrate \
  api web worker decision-worker

BENCHMARK_OUTPUT=docs/performance/evidence/2026-08-21-standard-stack.json \
bun run benchmark:capacity
```

Le scénario exécute :

- 1 000 lectures santé, concurrence 20 ;
- 1 000 lectures authentifiées, concurrence 20, réparties sur Aujourd'hui,
  Activité Inbound/Symbiose/Outbound, Prospects, Conversations, Pipeline,
  idées et publications ;
- 200 rendus SSR Aujourd'hui, concurrence 5 ;
- 200 rendus SSR Prospects hors campagne, concurrence 5 ;
- quatre crawls simultanés d'une page sur quatre domaines publics.

Le résultat brut versionné est
[`evidence/2026-08-21-standard-stack.json`](./evidence/2026-08-21-standard-stack.json).

## Résultats HTTP et SSR

| Scénario | Débit | p50 | p95 | p99 | Erreurs |
|---|---:|---:|---:|---:|---:|
| Santé API | 5 902,56 req/s | 1,53 ms | 10,74 ms | 22,55 ms | 0 |
| Mix opérationnel authentifié | 87,28 req/s | 135,91 ms | 865,33 ms | 997,74 ms | 0 |
| Aujourd'hui SSR | 53 req/s | 86,47 ms | 173,07 ms | 209,98 ms | 0 |
| Prospects SSR | 22,11 req/s | 210,61 ms | 366,40 ms | 602,64 ms | 0 |

Le mix opérationnel est volontairement agressif : vingt utilisateurs
concurrents demandent en boucle des agrégations différentes sur près de 39 000
messages. PostgreSQL atteint 828 % CPU et constitue la limite de ce scénario.
La page Prospects sollicite surtout Next.js : 270 % CPU et 955 Mio au pic.

## Crawler

Les quatre jobs publics ont produit quatre pages, sans erreur ni redémarrage.

| Mesure | Résultat |
|---|---:|
| Durée mur | 5,467 s |
| Jobs terminés | 4 / 4 |
| Pages produites | 4 |
| Pic crawler CPU | 235,29 % |
| Pic crawler RAM | 938,6 Mio |

Cette charge est bornée à quatre navigateurs, conformément à la configuration
du service. Les temps dépendent aussi des quatre sites et du réseau public.

## Mémoire, stabilité et disque

- empreinte chaude au repos après la charge : environ **2,16 Gio** pour les
  huit services ;
- pic total échantillonné : environ **2,54 Gio** pendant les quatre crawls ;
- zéro OOM, zéro redémarrage et zéro erreur HTTP/crawl ;
- images principales : environ **1,5 Go** logiques, hors couches partagées ;
- données locales actuelles : PostgreSQL 348 Mio, MinIO 5,2 Mio ;
- Docling retiré consommait encore 783,5 Mio au repos avant son arrêt. La
  baseline historique mesurait plus de 2 Gio après une extraction PDF.

La mémoire ne dimensionne donc plus le serveur initial. Le CPU, les pointes
Chromium, les agrégations PostgreSQL et la marge nécessaire aux sauvegardes
restent déterminants.

## Choix VPS

### Recommandé : RS 2000 G12

- 8 cœurs dédiés : cohérent avec le pic PostgreSQL à 8,28 cœurs et laisse le
  crawler travailler sans rendre l'interface imprévisible ;
- 16 Gio : plus de six fois le pic Noosphere mesuré, avec marge pour Linux,
  page cache, sauvegardes, croissance des données et un second workspace ;
- 512 Go NVMe : marge suffisante pour les images, volumes, preuves, métriques
  et rétention de sauvegardes initiale ;
- montée possible vers RS 4000 G12 dans la même génération selon Netcup.

### Acceptable uniquement pour une préproduction courte : VPS 2000 G12

Il permet une répétition horaire du canary à moindre coût. Ses vCPU partagés
peuvent cependant rendre variables les temps de crawl et les agrégations SQL.
Le VPS 1000 G12 (4 vCPU, 8 Gio) n'est pas recommandé : la charge mesurée peut
déjà occuper plus de quatre cœurs sans génération Kimi simultanée.

## Ce qui n'est pas encore une mesure réelle

- aucune génération Kimi K3 complète n'a été déclenchée ; son calcul est
  externe, mais la persistance, les retries et les réponses longues doivent
  être observés sur le VPS ;
- aucune publication LinkedIn réelle n'a été autorisée ;
- le workspace ne contenait encore aucun asset ou publication Inbound ; les
  endpoints Inbound ont donc été chargés avec leurs projections vides ;
- proxy TLS, sauvegarde simultanée et charge continue de 30 minutes restent à
  rejouer sur la machine x86_64 cible ;
- le canary produit PTC-101 reste `blocked_unverified` tant que la chaîne
  publication → interaction → contact → conversation → appel n'est pas
  observée avec un contenu et un compte explicitement autorisés.

## Canary de capacité à rejouer sur le RS 2000 G12

1. déployer la même révision et restaurer un snapshot expurgé du workspace ;
2. répéter ce benchmark pendant une sauvegarde ;
3. lancer un ICP `quick`, puis un cycle Inbound simulé complet ;
4. tenir 30 minutes avec quatre crawls et cinq SSR concurrents ;
5. vérifier CPU steal, swap, OOM, lag jobs et p95 ;
6. seulement ensuite exécuter le canary LinkedIn réel borné de PTC-101.
