# Frontière IA

## Décision

Le produit fonctionne en autopilote dans le chemin normal : le Setter IA peut
rechercher, rédiger, envoyer, relancer, qualifier et proposer un rendez-vous
lorsque la policy déterministe l’autorise. Une exception explicite (opt-out,
prix, juridique, sécurité, négociation, quota, compte dégradé) arrête l’action
et remonte sur la campagne, la conversation ou la configuration concernée.

## Dégradations déterministes et fallback

| Besoin futur | Fonctionnement initial | Évolution IA |
|---|---|---|
| lecture produit | brief et sources internes | Deep Agent sourcé, puis ICP publié automatiquement après audit |
| score prospect | règles d’éligibilité déterministes | score K3 expliqué et preuves conservées |
| personnalisation | faits contrôlés et policy publiée | message contextualisé envoyé par le Setter |
| qualification réponse | thread complet et état durable | classification et prochaine action structurées |
| réponse en campagne | policy, exclusions et compte sain | réponse IA autonome sous policy |
| réponse hors campagne | pilotage humain uniquement | amélioration de brouillon ou commande Setter explicite, jamais d’automatisme continu |
| recherche connaissance | filtres workspace et claims sourcés | retrieval hybride lorsque nécessaire |
| optimisation campagne | métriques déterministes | recommandations évaluées |
| contenu LinkedIn | stratégie, preuves, cadence et compte vérifiés | recherche, rédaction, audit, critique et publication autonomes ; exception localisée par asset |
| apprentissage éditorial | agrégation déterministe des réponses et appels attribués | recommandations versionnées consommables uniquement dans les piliers et l'ICP actifs |

## Contrats à prévoir dès le socle

- `AIModelProvider` : exécuter une demande structurée sans exposer un SDK au
  domaine ;
- `ProductUnderstandingService` : proposer des findings sourcés ; l’orchestrateur
  peut publier automatiquement l’ICP lorsque l’audit de preuves et les règles
  déterministes sont satisfaits ;
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
2. une lecture produit ne publie automatiquement un ICP qu’après réussite de
   l’audit adversarial et de la vérification déterministe des preuves ;
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
10. avant une publication LinkedIn automatique, le serveur relit le compte
    sélectionné, les claims autorisés, les jours de cadence et le budget
    hebdomadaire ; le modèle ne peut contourner cette frontière.
11. l'apprentissage éditorial distingue faits et inférences ; il ne peut ni
    ajouter un claim ou un canal, ni augmenter une cadence, ni élargir un ICP.

## Conditions d’exploitation de l’IA

La phase IA peut fonctionner en production lorsque :

- une campagne déterministe fonctionne de la sélection à la réponse ;
- les événements analytics et feedback sont fiables ;
- les corpus de claims et preuves sont validés ;
- un jeu d’évaluation réel et anonymisé est disponible ;
- les métriques de référence sans IA sont connues ;
- le budget, la latence et les seuils d’exception sont définis ;
- un dry-run et un canary fournisseur ont été exécutés sur un workspace isolé.
