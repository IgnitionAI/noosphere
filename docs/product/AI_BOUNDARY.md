# Frontière IA

## Décision

Le produit fonctionne en autopilote dans le chemin normal : le Setter IA peut
rechercher, rédiger, envoyer, relancer, qualifier et proposer un rendez-vous
lorsque la policy déterministe l’autorise. Une exception explicite (opt-out,
prix, juridique, sécurité, négociation, quota, compte dégradé) arrête l’action
et remonte dans « À traiter ».

## Dégradations déterministes et fallback

| Besoin futur | Fonctionnement initial | Évolution IA |
|---|---|---|
| lecture produit | segments réalistes simulés et éditables | détection de segments |
| score prospect | règles et pondérations de l’ICP | score assisté et explication |
| personnalisation | variables contrôlées + brouillon | message sourcé envoyé par le Setter |
| qualification réponse | statut choisi par l’opérateur | classification proposée |
| réponse | réponse manuelle | réponse IA autonome sous policy |
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
- `MessageDraftingService` : produire un brouillon contextualisé ; l’envoi
  reste dans le gateway et est revérifié par la policy ;
- `ReplyClassificationService` : proposer intention, confiance, prochaine
  action et escalade ;
- `AIEvaluationRecorder` : enregistrer le résultat attendu, le feedback et les
  métriques.

Les fallbacks déterministes utilisent les mêmes DTO que les agents afin de
préserver le workflow lorsque le fournisseur est indisponible ou qu’une sortie
est insuffisamment prouvée.

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
7. prix, engagement, sécurité, juridique, négociation sensible et opt-out
   créent une exception ; aucune réponse automatique implicite n’est envoyée ;
8. une recommandation ne modifie jamais une campagne active sans action
   idempotente de l’orchestrateur ;
9. chaque exécution conserve fournisseur, modèle, prompt, coût, latence et
   décision (politique appliquée ou exception déterministe).

## Gate de démarrage de la phase IA

La phase IA peut fonctionner en production lorsque :

- une campagne déterministe fonctionne de la sélection à la réponse ;
- les événements analytics et feedback sont fiables ;
- les corpus de claims et preuves sont validés ;
- un jeu d’évaluation réel et anonymisé est disponible ;
- les métriques de référence sans IA sont connues ;
- le budget, la latence et les seuils d’exception sont définis ;
- un dry-run et un canary fournisseur ont été exécutés sur un workspace isolé.
