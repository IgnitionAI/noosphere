# Checklist Guardian Noosphere

Cette checklist complète les contrôles automatiques. Elle ne remplace pas le
contrat normatif dans
[`ARCHITECTURE_CONTRACT.md`](./ARCHITECTURE_CONTRACT.md).

## Avant chaque merge

### Frontières

- [ ] Le changement appartient à un contexte borné identifié.
- [ ] Les règles métier vivent dans le domaine ou l'application, pas dans un
      handler, une page ou un adaptateur.
- [ ] Le domaine n'importe aucun framework, ORM, SDK provider ou LangChain.
- [ ] Les cas d'usage reçoivent leurs dépendances par port.
- [ ] Aucun payload Unipile, TEI ou provider social ne fuite dans le domaine.

### Tenant et données

- [ ] Workspace et utilisateur viennent du principal authentifié.
- [ ] Toute requête métier est scoped par `workspace_id`.
- [ ] Une fixture prouve qu'un autre workspace ne voit ni la ressource, ni sa
      provenance, ni ses événements.
- [ ] Chaque changement de schéma possède une migration et met à jour mapper,
      contrats et documentation du modèle de données.
- [ ] Une version publiée ou envoyée reste immuable.

### Jobs et providers

- [ ] Une action longue survit à la fermeture de la page ou du drawer.
- [ ] Le job utilise lease, heartbeat et reprise après crash quand requis.
- [ ] Tout effet externe possède une `requestKey` et un attempt durable.
- [ ] Une réponse provider ambiguë est réconciliée avant tout retry.
- [ ] L'outbox est écrite dans la transaction métier.
- [ ] Suppression, opt-out, quota, fenêtre, compte et policy sont revérifiés au
      dernier moment.
- [ ] Les logs excluent secrets, tokens et contenu personnel brut.

### IA et contexte

- [ ] L'agent est créé par invocation ; aucun singleton ne conserve de
      transcript, prospect ou workspace.
- [ ] Le contexte est reconstruit depuis des sources durables et bornées.
- [ ] Les faits importants ont une preuve résoluble ou sont marqués hypothèse.
- [ ] La mémoire Prospect 360 ne remplace pas l'historique brut.
- [ ] Le modèle propose ; la policy déterministe autorise l'effet.
- [ ] Le bouton d'amélioration ou un dry-run ne peut pas envoyer.
- [ ] Modèle, prompt, policy, preuves, latence et correlation ID sont traçables.

### Connaissance

- [ ] Un fichier non extractible ou `ocr_required` produit zéro chunk.
- [ ] Chaque chunk garde une provenance page/slide/feuille/section résoluble.
- [ ] La recherche filtre workspace et autorisations avant BM25/ANN.
- [ ] Une recherche n'utilise qu'une seule révision d'embedding.
- [ ] Aucune dépendance OpenAI Embeddings, Docling ou OCR n'est réintroduite
      implicitement.

### Produit

- [ ] Campagne et hors campagne restent distingués.
- [ ] LinkedIn, email et WhatsApp restent distingués.
- [ ] Une réaction sociale seule ne déclenche pas de DM automatique.
- [ ] Les exceptions sont locales ; le chemin normal n'impose pas une
      approbation humaine.
- [ ] Les filtres et drawers importants sont sérialisés dans l'URL.
- [ ] Les états loading, empty, partial, stale, reconnect et error sont couverts.
- [ ] Le Product Truth Contract concerné possède une preuve observable.

## Contrôles CI attendus

1. format/lint et types TypeScript ;
2. guardian des imports et de la composition ;
3. tests unitaires domaine/application ;
4. tests HTTP et contrats ;
5. tests PostgreSQL et migrations ;
6. tests d'isolation workspace et de double livraison ;
7. build API, workers, extracteur et Next.js sous Bun ;
8. tests crawler Python ;
9. scan de dépendances et secrets ;
10. E2E navigateur et Product Truth canary borné.

Commandes de base :

```bash
bun run check:types
bun run check:architecture
bun test tests/unit tests/http
bun run check:build
bun run check:web
```

## Refus automatique de merge

- accès Drizzle hors infrastructure ;
- accès direct à un provider depuis le domaine ou un modèle ;
- endpoint acceptant un workspace arbitraire sans vérification de session ;
- mutation d'un snapshot publié/envoyé ;
- effet externe sans idempotence ;
- agent singleton avec contexte utilisateur ;
- document `ocr_required` indexé dans le RAG ;
- retry d'un résultat provider inconnu sans réconciliation ;
- migration destructive en une seule étape ;
- affirmation « testé » sans niveau de preuve correspondant.
