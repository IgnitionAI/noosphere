# Frontière IA

## Décision

Le produit doit être entièrement utilisable avant l’introduction des modèles
IA. Les fondations stockent déjà le contexte, les preuves, les décisions et le
feedback nécessaires, mais aucun use case P0 ne dépend d’une génération.

## Remplacements pré-IA

| Besoin futur | Fonctionnement initial | Évolution IA |
|---|---|---|
| lecture produit | segments réalistes simulés et éditables | détection de segments |
| score prospect | règles et pondérations de l’ICP | score assisté et explication |
| personnalisation | variables contrôlées + rédaction humaine | brouillon sourcé |
| qualification réponse | statut choisi par l’opérateur | classification proposée |
| réponse | brouillon humain | brouillon IA à approuver |
| recherche connaissance | filtres et texte PostgreSQL | retrieval hybride/RAG |
| optimisation campagne | analytics déterministes | recommandations évaluées |

## Contrats à prévoir dès le socle

- `AIModelProvider` : exécuter une demande structurée sans exposer un SDK au
  domaine ;
- `ProductUnderstandingService` : proposer des findings sourcés sans publier
  l’offre ou l’ICP ;
- `KnowledgeRetriever` : retrouver des éléments sourcés indépendamment du
  moteur d’indexation ;
- `ProspectScoringPolicy` : retourner score, critères, faits et données
  manquantes ;
- `MessageDraftingService` : produire un brouillon, jamais envoyer ;
- `ReplyClassificationService` : proposer intention, confiance et escalade ;
- `AIEvaluationRecorder` : enregistrer le résultat attendu, le feedback et les
  métriques.

Les implémentations initiales de scoring, rédaction et classification sont
déterministes ou humaines. Elles utilisent les mêmes DTO afin d’éviter une
réécriture des workflows.

## Données à conserver avant l’IA

- versions exactes d’offre, ICP, stratégie, politique et séquence ;
- faits prospect avec provenance, date et confiance ;
- claims et preuves autorisés ;
- brouillon initial, modifications humaines et résultat envoyé ;
- réponse, qualification humaine et résultat commercial ;
- événements de livraison, réponse, rendez-vous et revenu ;
- suppressions et décisions d’escalade.

## Garde-fous permanents

1. un modèle ne déclenche jamais directement un envoi ;
2. une lecture produit ne publie jamais automatiquement une offre ou un ICP ;
3. les exclusions, suppressions et permissions restent déterministes ;
4. un score IA ne rend pas éligible un contact interdit ;
5. tout texte généré référence les faits et claims utilisés ;
6. une sortie sans preuve suffisante est bloquée ou escaladée ;
7. prix, engagement, sécurité, juridique et négociation sensible exigent une
   validation humaine ;
8. une recommandation ne modifie jamais une campagne active ;
9. chaque exécution conserve fournisseur, modèle, prompt, coût, latence et
   décision (politique appliquée ou exception humaine).

## Gate de démarrage de la phase IA

La phase IA peut commencer lorsque :

- une campagne déterministe fonctionne de la sélection à la réponse ;
- les événements analytics et feedback sont fiables ;
- les corpus de claims et preuves sont validés ;
- un jeu d’évaluation réel et anonymisé est disponible ;
- les métriques de référence sans IA sont connues ;
- le budget, la latence et les seuils d’escalade sont définis.
