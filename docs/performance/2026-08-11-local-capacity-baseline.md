# Baseline locale de capacité — 11 août 2026

## Objectif

Établir une première mesure CPU, mémoire et latence avant le choix du VPS
Netcup. Ce rapport distingue les valeurs effectivement mesurées des
extrapolations. Il ne remplace pas une répétition sur Linux x86_64 avec les
limites du serveur cible.

## Environnement

| Élément | Valeur |
|---|---|
| Machine | Apple M4, 10 cœurs, 16 Go RAM |
| OS | macOS 26.5.2 arm64 |
| Runtime applicatif | Bun 1.3.4, Next.js 16.2.11 standalone |
| Docker Desktop | VM limitée à 7,654 Gio |
| Base | ParadeDB 0.23.5 |
| Crawler | Crawl4AI/Chromium, maximum 4 crawls simultanés |
| Extraction | Docling Serve CPU 1.21.0, 1 worker |
| Autres services | MinIO et SearXNG |

Des conteneurs IgnitionRAG tournaient aussi sur la machine. Les métriques par
conteneur Outbound sont fiables, mais les temps CPU incluent donc une légère
contention externe. Les appels étaient locaux, sans latence réseau VPS.

## Scénarios et résultats

### HTTP isolé

Les scénarios ont été précédés d'un échauffement. Les réponses ont toujours
été entièrement lues. Aucune requête n'a échoué.

| Scénario | Charge | Débit | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| Santé API | 5 000, concurrence 50 | 25 305 req/s | 1,8 ms | 3,6 ms | 4,8 ms |
| Login Next production | 500, concurrence 10 | 445 req/s | 19,7 ms | 50,3 ms | 63 ms |
| Liste contacts authentifiée | 1 000, concurrence 20 | 580 req/s | 30,6 ms | 54,9 ms | 120,4 ms |
| Liste campagnes authentifiée | 1 000, concurrence 20 | 797,7 req/s | 23,9 ms | 33,6 ms | 41,3 ms |
| Page Prospects SSR | 200, concurrence 5 | 30,1 req/s | 154,7 ms | 277,5 ms | 364,3 ms |

La navigation `/login` mesurée dans Chromium donne un TTFB de 26 ms et un
chargement complet de 96 ms sur boucle locale.

### Crawler isolé

Quatre jobs sélectifs d'une page ont été lancés simultanément sur quatre
domaines publics distincts. Les quatre pages ont été produites sans erreur.

| Mesure | Résultat |
|---|---:|
| Temps mur | 3,885 s |
| Pic crawler CPU | 272,7 % |
| Pic crawler RAM | 1 093,6 Mio |

Le champ de progression `pagesCompleted` reste à zéro alors que
`result.pagesCount` vaut bien un. Le contenu est correctement produit, mais
la projection de progression doit être corrigée séparément.

### Docling isolé

Document : PDF public de 2,1 Mio et 15 pages, conversion PDF vers Markdown,
OCR et export d'images désactivés, structure de tableaux activée.

| Mesure | Résultat |
|---|---:|
| Temps mur | 41,536 s |
| Pic CPU | 99,6 % |
| Pic RAM | 2 701,3 Mio |
| Réponse Markdown/JSON | 1 072 617 octets |

Après l'extraction, Docling conserve environ 2,1 Gio en mémoire pour ses
modèles et caches. Le dimensionnement doit intégrer cette mémoire chaude, pas
uniquement la consommation au démarrage.

### Charge combinée

Le scénario exécute en même temps :

- une conversion Docling du même PDF ;
- quatre crawls d'une page ;
- 5 000 lectures authentifiées de contacts avec une concurrence de 20 ;
- 500 rendus SSR de la page Prospects avec une concurrence de 5.

| Mesure | Résultat |
|---|---:|
| Durée totale | 56,202 s |
| Requêtes en erreur | 0 |
| Redémarrages / OOM | 0 / 0 |
| Pic total échantillonné Outbound | 3 724 Mio |
| Pic Docker échantillonné | 3 327,5 Mio |
| API Bun, pic RSS | 236,6 Mio |
| Next standalone, pic RSS | 575 Mio |
| Docling, pic CPU / RAM | 509,6 % / 2 383,9 Mio |
| Crawler, pic CPU / RAM | 47,8 % / 861 Mio |
| ParadeDB, pic CPU / RAM | 82,3 % / 119,1 Mio |

Les pics individuels ne sont pas tous simultanés. Leur somme maximale est
4 360 Mio, tandis que le pic réellement échantillonné sur un même cycle est
3 724 Mio.

Sous contention, les performances évoluent ainsi :

| Parcours | Isolé | Combiné | Effet |
|---|---:|---:|---:|
| Contacts API, débit | 580 req/s | 150,9 req/s | -74 % |
| Contacts API, p95 | 54,9 ms | 230 ms | x4,2 |
| Prospects SSR, débit | 30,1 req/s | 11,3 req/s | -62 % |
| Prospects SSR, p95 | 277,5 ms | 814,6 ms | x2,9 |
| Docling, durée | 41,536 s | 56,2 s | +35 % |

Le CPU, et particulièrement Docling, constitue le premier facteur limitant.
La mémoire n'a pas saturé la VM Docker de 7,654 Gio pendant ce scénario.

## Empreinte disque constatée

- images d'infrastructure principales : environ 12 Go ;
- build Next local : 2,2 Go ;
- build backend : 14 Mo ;
- source/environnement crawler : 598 Mo ;
- données ParadeDB, MinIO, caches Docling, journaux et sauvegardes non inclus.

## Conclusion de capacité

### Minimum technique

Une machine de 8 Go peut probablement exécuter une seule boucle interne avec
un seul Docling et quatre crawls, mais la marge est insuffisante pour l'OS,
Docker, les sauvegardes, les pointes de Chromium et plusieurs workspaces. Ce
n'est pas une cible de production recommandée.

### Cible initiale recommandée

Une machine x86_64 avec 8 cœurs dédiés, 16 Go de RAM et 512 Go NVMe est la
cible initiale. Chez Netcup, cela correspond au RS 2000 G12. Le VPS 2000 G12
reste adapté pour une répétition horaire sans engagement avant achat durable.

### Quand passer à 32 Go

Le passage à 32 Go devient justifié si l'un de ces seuils est observé sur le
VPS :

- mémoire durable supérieure à 12 Go ;
- plusieurs conversions Docling simultanées ;
- plus de quatre navigateurs Chromium ;
- swap ou OOM ;
- plusieurs workspaces lançant des ICP profonds en parallèle.

## Limites et prochaine mesure

- CPU Apple M4 différent de l'AMD EPYC Netcup ;
- Docker Desktop différent d'un Docker Engine Linux natif ;
- aucun ICP profond Kimi complet n'a été lancé pendant cette passe ;
- pas de test de 30 à 60 minutes, ni de croissance des volumes ;
- pas de mesure des webhooks et envois fournisseurs sous charge.

La prochaine passe doit rejouer ce scénario sur un VPS 2000 G12 horaire,
ajouter un ICP `quick`, puis un ICP `deep`, et tenir une charge continue pendant
au moins 30 minutes.
