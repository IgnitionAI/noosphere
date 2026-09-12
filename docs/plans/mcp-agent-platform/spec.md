# Pilotage de Noosphere en langage naturel

## Problem Statement
Un utilisateur fournit son produit ou service et attend une acquisition Inbound et Outbound préparée. Le MCP sait lire des données, mais ses outils ne permettent pas encore de suivre tout le parcours sans retourner dans les formulaires.

## Solution
Un agent connecté au MCP consulte le contexte existant, demande seulement les données manquantes, prépare des livrables persistants et explique leur progression. L’interface et le MCP partagent les mêmes services métier, versions et permissions. Une préparation n’est jamais présentée comme un envoi effectué.

## User Stories
1. Comme utilisateur, je veux décrire mon produit une fois pour préparer les deux canaux.
2. Comme utilisateur, je veux réutiliser une étude terminée sans payer un nouveau calcul.
3. Comme utilisateur, je veux lire et modifier ma marque sans perdre mon logo.
4. Comme utilisateur, je veux consulter et modifier la stratégie Inbound depuis mon agent.
5. Comme utilisateur, je veux préparer la stratégie sans attendre une requête HTTP longue.
6. Comme utilisateur, je veux activer une version éditoriale explicitement sans publier de post.
7. Comme utilisateur, je veux retrouver les brouillons et leurs sources dans l’interface.
8. Comme utilisateur, je veux connaître les prérequis manquants et la prochaine action possible.
9. Comme utilisateur, je veux suivre une opération longue et reprendre après un incident.
10. Comme utilisateur, je veux rejouer une commande sans doublon.
11. Comme utilisateur, je veux une campagne liée à la bonne offre et au bon ICP.
12. Comme utilisateur, je veux suspendre et activer une campagne selon mes permissions.
13. Comme administrateur, je veux que scopes, rôles et isolation s’appliquent aux nouvelles capacités.
14. Comme superadmin, je conserve seul l’administration IA d’instance.
15. Comme utilisateur, je veux une preuve par un agent réel utilisant le MCP.

## Implementation Decisions
Réutiliser les applications existantes et le registre transactionnel MCP. Fournir des outils métier structurés, pas une seconde logique commerciale. Les identifiants proviennent des lectures MCP. Les générations sont des opérations durables. Les modifications de marque préservent les champs absents et vérifient la version attendue. Pas de migration prévue avant d’avoir épuisé les primitives existantes.

## Testing Decisions
Frontière principale : appels du SDK MCP authentifié puis relecture des résultats. Contrôles complémentaires aux services publics déjà testés, avec PostgreSQL isolé pour persistance, concurrence, idempotence et isolation. Une preuve en langue naturelle utilise un agent et observe les résultats dans l’application. Les tests contrôlés ne prouvent pas les envois provider réels.

## Out of Scope
Modifier Hermes, envoyer à des destinataires non autorisés, ajouter un nouveau chat intégré, modifier les modèles configurés, activer implicitement des campagnes réelles, déployer automatiquement en production.

## Further Notes
Plan accepté dans la conversation. Travail local sur la branche canary existante. Les validations de publication et d’envoi suivent les politiques déjà autorisées, sans contourner les contrôles. Base de revue : 8c0b28a.
