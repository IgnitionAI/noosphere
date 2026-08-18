# Acceptation de la boucle simple

## Résultat attendu

```text
Lancer un ICP → campagnes autonomes → rendez-vous réservés
                          ↘
          Messages LinkedIn, email et WhatsApp consultables et répondables
```

## Matrice de preuve locale

| Exigence | Implémentation | Preuve automatisée |
|---|---|---|
| Un lancement crée et démarre l’étude | action serveur `createResearchMission` | smoke de la page ICP + contrats recherche |
| Un ICP valide est publié automatiquement | audit adversarial puis publication V3 | `v3-auto-publication.test.ts` |
| Les campagnes utiles sont créées sans approbation | campaign mono-canal avec policy `live` | `v3-auto-publication.test.ts` |
| Le sourcing vide reprend chaque jour à 06:00 | schedule durable, campagnes actives ou en sourcing | `v3-auto-publication.test.ts`, `whatsapp-sourcing-v1.test.ts` |
| Le sourcing n’a pas de plafond global | curseurs LinkedIn exhaustifs et limite email/WhatsApp nulle ; budget seulement quotidien | `unipile-prospect-source.test.ts` + contrats de sourcing |
| Les envois respectent la policy | suppression, identité, compte, quota et fenêtre revérifiés | `outbound-send-safety.test.ts` et tests de dispatch |
| Une réponse arrête les relances | annulation avant classification | `v3-auto-publication.test.ts` |
| Le Setter qualifie et répond en campagne | classification, prochaine action, réponse durable | `v3-auto-publication.test.ts` |
| Un rendez-vous est réservé une seule fois | slots réels du port calendrier, idempotence et opportunité | `calendar-setter.test.ts`, `meeting-proposal-manager.test.ts` |
| Les comptes associés sont tous reflétés | backfill et curseurs durables par compte | `inbox-mirror.test.ts` |
| Une conversation hors campagne reste humaine | origine et mode `human` à la création | `inbox-mirror.test.ts` |
| Une réponse humaine arrête le Setter | annulation de la réponse en attente et mode `human` | `v3-auto-publication.test.ts` |
| L’utilisateur peut lire et répondre | inbox unifiée, envoi manuel, amélioration IA sans envoi | smoke web + tests HTTP des commandes |

## Frontière de validation

Cette matrice approuve le comportement local et les contrats fournisseur avec
des doubles de test. Elle n’est pas une preuve de production. Avant ouverture
sur le VPS, il reste volontairement un canary borné sur les comptes réels :
webhook public, synchronisation après redémarrage, un envoi contrôlé et une
réservation/annulation de rendez-vous de test.
