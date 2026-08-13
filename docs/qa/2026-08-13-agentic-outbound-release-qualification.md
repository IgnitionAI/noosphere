# Qualification release du moteur agentique Outbound

Date : 2026-08-13  
Branche : `feat/durable-agentic-outbound`  
Base : `dev`  
Verdict : approuvé pour merge et exploitation en `dry_run`; activation live bloquée par le quota Unipile constaté pendant la qualification.

## Périmètre qualifié

- décision durable Kimi K3 par prospect;
- conservation et validation du contexte de campagne;
- séparation du worker de décisions et des recherches longues;
- affichage prospect/campagne, audit et retour de navigation;
- protections dry-run, isolation workspace et absence d'envoi pendant la qualification;
- contrats réels Kimi, Unipile en lecture et crawler.

## Résultats automatisés

| Gate | Résultat |
|---|---:|
| Unitaires et HTTP | 318 réussis, 0 échec |
| Crawler Python | 40 réussis, 0 échec |
| PostgreSQL intégration | 101 réussis, 0 échec |
| TypeScript | réussi |
| Build API et worker | réussi |
| Build Next.js production | réussi |

Commandes :

```bash
bun run check
bun run test:integration
```

## Contrats réels

- Kimi Code, modèle `k3` : boucle `createAgent`, tool call réel et sortie structurée Zod réussis.
- Crawler : recherche web réelle, lecture de `https://ignitionrag.com`, Markdown normalisé et hash présents.
- Unipile : `GET /api/v1/accounts` réussi; cinq comptes visibles, dont un compte LinkedIn sain. Aucun identifiant ni secret n'est conservé dans ce rapport.

## Canary produit

Depuis une fiche prospect ouverte par une campagne LinkedIn :

1. déclenchement manuel d'une décision `dry_run`;
2. persistance du `campaignId` après validation workspace/prospect;
3. traitement par le worker de décisions dédié alors que le worker général exécutait des recherches longues;
4. réponse Kimi persistée en une tentative;
5. décision finale `wait` en 14 secondes;
6. aucun appel d'envoi Unipile et aucun doublon;
7. audit visible après rechargement et retour vers la campagne fonctionnel;
8. aucune erreur console dans la session navigateur finale.

## Défauts trouvés et corrigés

### ISSUE-001, contexte de campagne perdu

La réévaluation depuis une campagne transmettait seulement un `returnTo`. La décision Kimi était donc exécutée sans campagne. Le frontend extrait désormais uniquement un UUID de campagne direct et sûr; l'API vérifie que le prospect appartient réellement à cette campagne avant de le persister.

### ISSUE-002, décisions affamées par le sourcing

Un worker unique attendait la fin de recherches longues avant de relire la file, même pour une décision de priorité 90. Le lancement local et le runbook séparent maintenant :

- `worker:general`, qui exclut `prospect.decision.execute`;
- `worker:decision`, réservé à `prospect.decision.execute` et sans boucles de maintenance/outbox/scheduler.

### ISSUE-003, CI absente sur les PR vers dev

Le workflow GitHub ne ciblait que les PR vers `preprod` et `prod`. La branche `dev` est maintenant incluse.

## Blocage externe live

La campagne réelle testée expose correctement :

```text
Unipile 422 limit_exceeded
```

Le produit reste en `dry_run` et n'envoie rien. C'est le comportement sûr attendu. Une campagne live ne peut pas être approuvée tant que le quota fournisseur n'est pas rétabli, puis vérifié par un canary d'envoi vers une destination interne explicitement autorisée.

## Décision de release

- Merge vers `dev` : **APPROUVÉ** après CI GitHub verte.
- Staging et dry-run : **APPROUVÉ**.
- Activation live générale : **NON APPROUVÉE** tant que le quota Unipile est dépassé.

