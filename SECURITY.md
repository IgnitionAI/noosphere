# Sécurité

Ce dépôt est privé. Ne créez pas d’issue publique pour signaler une
vulnérabilité.

## Données interdites

- credentials Unipile, fournisseurs IA ou enrichissement ;
- cookies et sessions LinkedIn ;
- emails, téléphones ou messages réels de prospects ;
- exports CRM de production ;
- secrets de chiffrement ou URLs de base contenant des credentials.

Les données du prototype sont fictives.

## Signalement

Signaler directement le problème au propriétaire du dépôt avec :

- composant concerné ;
- impact estimé ;
- étapes minimales de reproduction ;
- proposition de mitigation si disponible.

## Règles structurantes

- isolation stricte par workspace ;
- autorisation vérifiée côté serveur ;
- webhooks signés et idempotents ;
- suppressions contrôlées avant chaque envoi ;
- payloads personnels exclus des logs par défaut.
