# Réconciliation architecture Noosphere — 24 août 2026

> Statut : audit statique daté. La source AS-IS est
> [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md).

## Pourquoi cet audit

La documentation principale décrivait encore une version antérieure à Content
Inbound, Prospect 360, aux workers spécialisés, à l'extraction Office locale et
au moteur Qwen/ParadeDB. Des plans cibles étaient plus récents que les fichiers
canoniques, ce qui rendait l'architecture difficile à comprendre.

## Baseline vérifiée

- dépôt distant : `IgnitionAI/noosphere` ;
- runtime principal : Bun/TypeScript, Next.js et workers PostgreSQL ;
- exception : crawler FastAPI/Crawl4AI Python ;
- processus spécialisés : worker général, décision, Setter et mémoire ;
- deux moteurs produit : Outbound et Content Inbound LinkedIn ;
- mémoire centrale Prospect 360, reconstruite pour chaque invocation IA ;
- documents : extraction locale PDF/DOCX/PPTX/XLSX/HTML/texte, sans Docling ni OCR ;
- recherche : ParadeDB BM25 + pgvector Qwen 1 024 + RRF + reranker BGE ;
- providers IA configurables : Codex ou Kimi ;
- provider de comptes LinkedIn/email/WhatsApp : Unipile.

Au moment de l'audit, le schéma TypeScript déclarait 137 tables et l'OpenAPI
191 chemins. Ces nombres sont des repères datés, pas des invariants.

## Documents réconciliés

- architecture et topologie ;
- domaine et ownership ;
- catalogue logique des données ;
- familles API ;
- flux critiques ;
- contrat d'architecture et checklist Guardian ;
- Product Truth Contracts ;
- abonnements requis ;
- gouvernance documentaire ;
- statut des anciennes architectures et galerie de maquettes.

## Ce que cet audit ne prouve pas

La lecture statique ne prouve pas :

- un canary réel Unipile ;
- une publication LinkedIn réelle ;
- la qualité d'un rapport ICP sur un nouveau workspace ;
- la capacité mémoire du VPS sous charge ;
- les seuils de qualité cross-lingues du RAG.

Ces affirmations nécessitent leurs tests d'intégration, benchmarks et Product
Truth canaries respectifs.

## Décision

Les fichiers canoniques portent désormais l'AS-IS. Les documents Noosphere
datés restent des décisions historiques ou des contrats visuels ; ils renvoient
explicitement vers la source courante lorsqu'une partie a été implémentée ou
remplacée.
