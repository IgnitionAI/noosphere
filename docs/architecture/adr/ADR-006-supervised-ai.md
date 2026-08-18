# ADR-006 — IA supervisée et traçable

## Statut
Remplacée par la décision produit D-003 (2026-08-02) : autopilote sans
validation humaine dans le chemin normal, exceptions en file F-033. La
traçabilité (claims, sources, prompt, modèle, politique, feedback) reste
acquise.

## Décision
Recherche, enrichissement, scoring, rédaction, premier contact et réponses
peuvent être exécutés automatiquement dans les bornes d’une policy publiée.
La policy est déterministe et revérifiée juste avant chaque action. Les
exceptions (opt-out, prix, juridique, sécurité, négociation, quota ou compte
dégradé) sont interrompues et présentées dans la surface « À traiter » ; elles
ne constituent pas une approbation humaine obligatoire du chemin normal.
Claims, sources, prompt, modèle, policy, coût, latence et feedback sont
conservés.

## Motifs et conséquences
L’automatisation gagne du temps tout en bornant les décisions commerciales
sensibles. Une file d’exceptions remplace la file d’approbation généralisée et
ne bloque que les cas explicitement définis.

## Date
2026-07-24
