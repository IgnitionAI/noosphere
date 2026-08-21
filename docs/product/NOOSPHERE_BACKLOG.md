# Noosphere — backlog produit validé

Date : 2026-08-20

Architecture validée :
[`NOOSPHERE_EXPERIENCE_ARCHITECTURE.md`](../architecture/NOOSPHERE_EXPERIENCE_ARCHITECTURE.md)

Contrat visuel : [`design/noosphere/`](../../design/noosphere/)

Décision structurante :
[`ADR-011`](../architecture/adr/ADR-011-noosphere-axis-navigation-lens.md)

> **Statut : prêt à implémenter.** Le Noosphere Axis, les huit écrans P0 et le
> parcours Offre/ICP → moteurs actifs → conversations → appels sont validés.
> Les tickets ci-dessous remplacent l'ancien backlog pré-maquettes. Ils ne
> doivent être publiés sur GitHub que dans l'ordre des lots.

## 1. Résultat produit attendu

Noosphere doit rendre vrai ce parcours sans intervention quotidienne :

1. l'utilisateur décrit son offre et lance un ICP ;
2. Outbound crée et exécute les campagnes éligibles ;
3. Inbound propose, rédige, planifie et publie les contenus LinkedIn ;
4. Symbiose transforme les engagements prouvés en signaux exploitables ;
5. les conversations LinkedIn, email et WhatsApp restent visibles et
   répondables ;
6. le Setter qualifie selon une policy déterministe ;
7. l'utilisateur récolte les appels et comprend leur origine.

Changer la position du Noosphere Axis ne modifie jamais un job, une cadence,
une policy ou un compte.

## 2. Definition of Done commune

Chaque ticket P0 doit :

- livrer une tranche verticale démontrable, pas seulement une table ou un
  composant ;
- préserver l'isolation workspace, le RBAC, l'audit et l'idempotence ;
- exposer les états `loading`, `empty`, `error` et `success` ;
- conserver les filtres, drawers et retours dans l'URL ;
- fonctionner à 390 px et 1440 px selon la galerie validée ;
- ne jamais perdre un job lorsqu'une page est quittée ;
- distinguer intention, tentative, acceptation provider, livraison et réponse ;
- vérifier suppression, quota, compte, fenêtre et policy juste avant tout effet
  externe ;
- inclure tests de contrat, intégration PostgreSQL et parcours navigateur ;
- rattacher sa preuve produit à un Product Truth Contract ;
- rester en provider simulé tant qu'un canary réel borné n'est pas autorisé.

## 3. Travail existant à conserver

État GitHub vérifié le 2026-08-20 :

| Issue | Statut kanban | Rôle dans la cible |
|---|---|---|
| [#15 PERF-001](https://github.com/IgnitionAI/noosphere/issues/15) | In progress | benchmark VPS ; rebaseline après ajout d'Inbound |
| [#16 BUG crawler](https://github.com/IgnitionAI/noosphere/issues/16) | Todo | progression fiable des jobs de recherche |
| [#17 AI-150](https://github.com/IgnitionAI/noosphere/issues/17) | In progress | prochaine décision durable partagée par Outbound et Setter |

Ces issues ne sont pas dupliquées. La clôture de #17 est un prérequis au lot 1 ;
#16 doit être corrigée avant le premier PTC de recherche ; #15 reçoit une
seconde campagne de mesure après `LNK-102`.

## 4. Vue d'ensemble

| ID | P | Lot | Titre | Taille | Dépendances |
|---|---:|---:|---|---:|---|
| NOO-101 | P0 | 0 | Installer le Noosphere Axis et les routes compatibles | M | — |
| NOO-102 | P0 | 0 | Projeter la santé des deux moteurs | L | NOO-101 |
| NOO-103 | P0 | 0 | Livrer le shell et la page Aujourd'hui | M | NOO-102 |
| OPS-101 | P0 | 0 | Unifier les exceptions réellement actionnables | M | NOO-102 |
| OUT-101 | P0 | 1 | Migrer les campagnes vers Activité Outbound | L | NOO-101, #17 |
| CRM-101 | P0 | 1 | Unifier les prospects et leur origine | M | NOO-101 |
| CON-101 | P0 | 1 | Stabiliser l'inbox multicanale canonique | L | NOO-101, #17 |
| CALL-101 | P0 | 1 | Livrer la surface Appels orientée résultat | M | NOO-101 |
| CFG-101 | P0 | 1 | Transformer Settings en Configuration guidée | M | NOO-101 |
| STR-101 | P0 | 2 | Dériver une stratégie Inbound de l'offre et de l'ICP | L | CFG-101 |
| IDE-101 | P0 | 2 | Rechercher des idées sourcées et dédupliquées | L | STR-101, #16 |
| CNT-101 | P0 | 2 | Générer et critiquer un contenu non générique | XL | IDE-101 |
| PUB-101 | P0 | 2 | Planifier une publication durable | XL | CNT-101, CFG-101 |
| LNK-101 | P0 | 2 | Publier un post LinkedIn texte via capacité observée | XL | PUB-101 |
| LNK-102 | P0 | 2 | Synchroniser calendrier, posts et métriques LinkedIn | L | LNK-101 |
| ENG-101 | P0 | 3 | Ingérer les engagements LinkedIn sans doublon | L | LNK-101 |
| ATT-101 | P0 | 3 | Résoudre identité et attribution avec preuves | XL | ENG-101, CRM-101 |
| SYM-101 | P0 | 3 | Livrer Activité Symbiose et ses parcours attribués | L | ATT-101, NOO-103 |
| CRM-102 | P0 | 3 | Prioriser un prospect grâce aux signaux Inbound | L | ATT-101, OUT-101 |
| CON-102 | P0 | 3 | Unifier commentaires sociaux et conversations | L | ENG-101, CON-101 |
| REV-101 | P0 | 3 | Attribuer les appels au contenu et aux campagnes | M | ATT-101, CALL-101 |
| AUT-101 | P0 | 4 | Exécuter la boucle éditoriale LinkedIn quotidienne | XL | LNK-102, OPS-101 |
| AUT-102 | P0 | 4 | Apprendre des réponses sans modifier la policy seul | L | ATT-101, AUT-101 |
| OPS-102 | P0 | 4 | Réconcilier les effets provider inconnus | L | PUB-101, OPS-101 |
| PTC-101 | P0 | 4 | Prouver le parcours LinkedIn réel de bout en bout | M | AUT-101, CON-102, REV-101, OPS-102 |
| MED-201 | P1 | 5 | Ajouter médias et brand kit partagés | L | PUB-101 |
| X-201 | P1 | 5 | Étendre publication et engagement à X | XL | PUB-101, ENG-101 |
| VID-201 | P1 | 5 | Produire un rendu vidéo vertical reproductible | XL | MED-201, CNT-101 |
| YT-201 | P2 | 6 | Publier et mesurer YouTube Shorts | XL | VID-201, PUB-101 |
| TTK-201 | P2 | 6 | Publier et mesurer TikTok Shorts | XL | VID-201, PUB-101 |
| ANA-201 | P1 | 6 | Mesurer contenu et prospection jusqu'au revenu | L | ATT-101, REV-101 |

## 5. Lot 0 — installer le produit Noosphere

### NOO-101 — Installer le Noosphere Axis et les routes compatibles

**Build.** Introduire `Inbound | Symbiose | Outbound` comme paramètre de lecture
dans le shell et sur `/activity`, puis rediriger les routes historiques sans
perdre leurs filtres.

**Preuve visible.** Les trois positions changent la projection affichée ; les
operation IDs et prochaines actions des workers restent identiques.

**Acceptation.** Le composant est accessible au clavier, encode `lens` dans
l'URL, n'importe aucune commande métier et ne déclenche aucun `POST`, `PUT`,
`PATCH` ou `DELETE`.

### NOO-102 — Projeter la santé des deux moteurs

**Build.** Créer une projection workspace-scoped donnant santé Inbound,
Outbound, prochaines publications/campagnes, conversations, appels, jobs et
`asOf`.

**Preuve visible.** Une erreur LinkedIn Inbound n'efface ni les campagnes email
ni les rendez-vous ; chaque moteur conserve son état propre.

**Acceptation.** Agrégations SQL déterministes, pagination des exceptions,
permissions testées et aucune table de read-model persistante avant mesure.

### NOO-103 — Livrer le shell et la page Aujourd'hui

**Build.** Implémenter les cinq destinations validées et la page Aujourd'hui à
partir de `screen-today.html`.

**Preuve visible.** En moins de dix secondes, l'utilisateur voit si les deux
moteurs travaillent, ce qui arrive ensuite et ce qui demande réellement son
attention.

**Acceptation.** Même ordre desktop/mobile ; `Messages` est le libellé mobile
compact de Conversations ; état stale visible ; aucune métrique décorative.

### OPS-101 — Unifier les exceptions réellement actionnables

**Build.** Projeter les comptes dégradés, résultats partiels, retries épuisés,
policies bloquantes et rendez-vous non réconciliés dans une liste unique.

**Preuve visible.** Chaque exception ouvre la ressource concernée et propose une
seule récupération ; “Rien à traiter” signifie réellement que l'automatisation
peut continuer seule.

**Acceptation.** Tri risque/ancienneté, explication normalisée, correlation ID,
redaction des secrets et aucune duplication par relivraison webhook.

## 6. Lot 1 — faire entrer Outbound dans le nouveau modèle mental

### OUT-101 — Migrer les campagnes vers Activité Outbound

**Build.** Faire d'Activité Outbound la vue canonique des ICP et campagnes
existantes : sourcing, enrichissement, scoring, rédaction, envoi, relance,
qualification et réservation.

**Preuve visible.** Lancer un ICP crée les campagnes utiles et leur progression
reste visible après navigation, reload ou redémarrage worker.

**Acceptation.** Pas de campagne vide créée pour remplir l'interface ; actions
pause/reprise/recherche idempotentes ; détails historiques accessibles par URL.

### CRM-101 — Unifier les prospects et leur origine

**Build.** Adapter la liste et la fiche Prospect 360 aux filtres ICP, campagne,
hors campagne, LinkedIn, email, WhatsApp, signal, statut et période.

**Preuve visible.** Un prospect affiche origine Inbound, Outbound ou mixte,
preuves, score, canaux disponibles, avis IA et prochaine décision durable.

**Acceptation.** Aucun canal n'est inféré ; email probable non vérifié jamais
envoyé ; filtres dans l'URL ; retour vers la vue source sans perte de contexte.

### CON-101 — Stabiliser l'inbox multicanale canonique

**Build.** Rendre `/inbox` canonique pour tous les threads LinkedIn, email et
WhatsApp, campagne ou hors campagne.

**Preuve visible.** L'utilisateur peut lire, répondre manuellement, améliorer
un brouillon ou déléguer au Setter depuis le même écran.

**Acceptation.** Améliorer ne signifie jamais envoyer ; hors campagne ne lance
aucune automation implicite ; réponse humaine annule l'action Setter concurrente.

### CALL-101 — Livrer la surface Appels orientée résultat

**Build.** Réunir rendez-vous, opportunité, contact, entreprise, prochaine
action, statut calendrier et source connue.

**Preuve visible.** L'utilisateur voit ses prochains appels et peut remonter à
la conversation qui les a produits.

**Acceptation.** Un booking correspond à un rendez-vous durable ; fuseaux
explicites ; annulation, déplacement et no-show ne dupliquent rien.

### CFG-101 — Transformer Settings en Configuration guidée

**Build.** Implémenter la checklist validée : offre, ICP, comptes, autonomie,
agenda et connaissance optionnelle.

**Preuve visible.** Chaque étape explique son état, l'action suivante et son
impact. Quitter puis reprendre ne perd rien.

**Acceptation.** Une étape n'est prête que si le prérequis serveur est vrai ;
agenda et connaissance peuvent rester optionnels ; comptes déjà connectés sont
reconnus sans refaire l'onboarding.

## 7. Lot 2 — tracer bullet Inbound LinkedIn

### STR-101 — Dériver une stratégie Inbound de l'offre et de l'ICP

**Build.** Produire une stratégie versionnée contenant audience, piliers,
niveau de conscience, voix, formats, cadence, CTA, claims autorisés et sujets
interdits.

**Preuve visible.** Une offre publiée et un ICP actif suffisent à proposer une
stratégie exploitable et lisible dans Activité Inbound.

**Acceptation.** Modifier le brouillon n'altère aucun contenu planifié ; les
sources et versions consommées sont conservées ; sortie structurée rejetée si
incomplète.

### IDE-101 — Rechercher des idées sourcées et dédupliquées

**Build.** Alimenter un radar quotidien depuis preuves produit, questions de
prospects, objections réelles et sources publiques autorisées.

**Preuve visible.** Chaque idée indique angle, ICP, fraîcheur, sources et raison
de priorité ; une recherche interrompue reprend depuis son curseur.

**Acceptation.** Zéro idée inventée sans provenance ; doublons regroupés ;
budget et durée bornés par run ; la recherche ne publie rien.

### CNT-101 — Générer et critiquer un contenu non générique

**Build.** Pipeline `brief → writer → evidence auditor → critic indépendant →
version prête`, avec l'offre complète, l'ICP, les preuves, les conversations et
l'historique éditorial.

**Preuve visible.** La preview explique les preuves et rejette hooks génériques,
faux chiffres, répétitions, ton interchangeable et CTA non relié à l'offre.

**Acceptation.** Chaque réécriture crée une version ; aucun fait non sourcé
n'entre comme fait ; améliorer ne planifie ni ne publie.

### PUB-101 — Planifier une publication durable

**Build.** Créer Publication, calendrier, snapshot de contenu, lease, retry,
annulation, déplacement et gate de dernière seconde.

**Preuve visible.** Une publication survit au reload et aux redémarrages ; elle
est publiée au plus une fois ou reste explicitement à réconcilier.

**Acceptation.** Clé d'idempotence, policy et compte versionnés ; résultat
provider inconnu jamais rejoué automatiquement ; historique immuable.

### LNK-101 — Publier un post LinkedIn texte via capacité observée

**Build.** Sonder les capacités du compte Unipile, générer la variante LinkedIn
et publier un post texte par le port provider existant.

**Preuve visible.** Un compte sain publie une fois, conserve l'ID provider et
expose le lien ; un compte dégradé bloque uniquement ce job.

**Acceptation.** Aucun secret navigateur ; payloads 422/429/5xx classifiés ;
tests contractuels sur fixtures expurgées ; canary réel reporté à PTC-101.

### LNK-102 — Synchroniser calendrier, posts et métriques LinkedIn

**Build.** Rattraper posts internes/externes, statuts et snapshots des métriques
disponibles puis les afficher dans Activité Inbound.

**Preuve visible.** Calendrier, publication provider et métriques convergent
après un redémarrage sans créer de contenu fantôme.

**Acceptation.** Métriques cumulatives non additionnées en deltas ; fraîcheur
visible ; post externe marqué comme tel ; curseur durable.

## 8. Lot 3 — rendre Symbiose réellement utile

### ENG-101 — Ingérer les engagements LinkedIn sans doublon

**Build.** Normaliser commentaires, réponses, réactions et mentions avec clé
provider, auteur, date, publication et provenance.

**Preuve visible.** Un événement relivré apparaît une fois ; les interactions
du propriétaire du compte sont distinguées des entrantes.

**Acceptation.** Suppression/modification réconciliées ; identité inconnue
conservée ; une réaction seule ne déclenche jamais un message.

### ATT-101 — Résoudre identité et attribution avec preuves

**Build.** Relier publication, interaction, contact, conversation, campagne et
appel par des edges d'attribution explicables.

**Preuve visible.** La vue peut remonter du call au touchpoint source ou afficher
`unknown` sans inventer de causalité.

**Acceptation.** Confiance et règle visibles ; aucune fusion faible ; first et
last touch reproductibles ; preuve ouvrable pour chaque edge affirmé.

### SYM-101 — Livrer Activité Symbiose et ses parcours attribués

**Build.** Implémenter la file des signaux prioritaires et le parcours
source → interaction → identité → conversation → appel.

**Preuve visible.** L'utilisateur comprend ce que les contenus ont réellement
produit et quelle suite est prévue.

**Acceptation.** Aucun KPI d'engagement décoratif ; distinction preuve,
inférence et inconnu ; ouvrir un signal ne déclenche aucune activation.

### CRM-102 — Prioriser un prospect grâce aux signaux Inbound

**Build.** Ajouter les signaux sociaux prouvés au scoring et à la prochaine
décision Outbound, sous ICP, suppression et policy.

**Preuve visible.** La fiche prospect explique pourquoi le signal change ou ne
change pas sa priorité.

**Acceptation.** Signal expiré exclu ; like seul sans action ; conversation
sociale ouverte empêche un DM contradictoire ; décision idempotente.

### CON-102 — Unifier commentaires sociaux et conversations

**Build.** Rendre les commentaires/réponses LinkedIn consultables et répondables
dans Conversations avec contexte du post et de l'attribution.

**Preuve visible.** Réponse manuelle, amélioration IA et Setter utilisent le
même thread et le même contexte prouvé.

**Acceptation.** Action humaine prioritaire ; opt-out immédiat ; prix,
juridique, sécurité et négociation deviennent des exceptions ciblées.

### REV-101 — Attribuer les appels au contenu et aux campagnes

**Build.** Enrichir Appels avec les sources Inbound, Outbound, mixtes ou
inconnues et le chemin de conversion.

**Preuve visible.** Un rendez-vous confirmé affiche la conversation, le contenu
ou la campagne qui l'a influencé, sans forcer une attribution.

**Acceptation.** Booking unique ; modèle d'attribution affiché ; parcours
recalculable ; aucune source absente transformée en zéro.

## 9. Lot 4 — autonomie et preuve produit

### AUT-101 — Exécuter la boucle éditoriale LinkedIn quotidienne

**État.** Livré et validé en simulation provider le 21 août 2026 ; le canary
réel reste couvert par PTC-101.

**Build.** À l'heure configurée : chercher des idées, générer les briefs,
rédiger, critiquer, planifier et publier selon stratégie, cadence et budget.

**Preuve visible.** Le chemin normal ne demande aucune validation humaine ; les
exceptions suspendent seulement l'asset concerné.

**Acceptation.** Pause/reprise immédiate et auditée ; collisions évitées ; jobs
reprenables ; budget atteint restitue un résultat partiel sans perte.

**Spécification.**
[`AUT-101-LINKEDIN-EDITORIAL-AUTOPILOT.md`](features/AUT-101-LINKEDIN-EDITORIAL-AUTOPILOT.md).

### AUT-102 — Apprendre des réponses sans modifier la policy seul

**État.** Livré et validé en simulation provider le 21 août 2026.

**Build.** Produire des recommandations de piliers, angles et ciblage à partir
des réponses et appels attribués.

**Preuve visible.** Noosphere explique l'apprentissage proposé et peut l'utiliser
au prochain run dans les bornes déjà autorisées.

**Acceptation.** Aucune hausse de quota, nouveau claim, nouveau canal ou
élargissement d'ICP sans configuration explicite ; recommandations versionnées.

**Spécification.**
[`AUT-102-BOUNDED-EDITORIAL-LEARNING.md`](features/AUT-102-BOUNDED-EDITORIAL-LEARNING.md).

### OPS-102 — Réconcilier les effets provider inconnus

**Build.** Étendre la reprise aux publications, commentaires et réponses dont
le provider a peut-être accepté l'effet avant timeout ou crash.

**Preuve visible.** L'opérateur voit `unknown`, la recherche provider et la
décision finale ; aucun bouton ne rejoue aveuglément l'action.

**Acceptation.** Deux workers ne publient jamais le même snapshot ; correlation
complète ; payloads expurgés ; reprise testée après kill du worker.

### PTC-101 — Prouver le parcours LinkedIn réel de bout en bout

**Build.** Exécuter sur un compte canary borné : stratégie, idée sourcée,
contenu, publication réelle, interaction réelle, réponse, signal CRM,
conversation et rendez-vous attribué ou scénario contrôlé jusqu'à la réservation.

**Preuve visible.** Chaque étape possède un ID provider ou une preuve durable et
le rapport distingue clairement le réel du simulé.

**Acceptation.** Autorisation explicite du compte et du contenu canary ; zéro
duplication après redémarrage ; URLs résolubles ; verdict L0-L5 ; aucune
revendication “prêt” avant succès.

## 10. Lots ultérieurs

### MED-201 — Médias et brand kit

Bibliothèque workspace, droits, hashes, previews et variantes LinkedIn image ou
document. Aucun média généré sans provenance ni manifest.

### X-201 — X

Capacités réelles, publication, threads, mentions, réponses, métriques et
attribution. Canary propre au canal obligatoire.

### VID-201 — Rendu vertical

Script, storyboard, narration, sous-titres et MP4 9:16 reproductibles derrière
un port `MediaRenderer`.

### YT-201 — YouTube Shorts

OAuth, upload resumable privé, processing, publication, commentaires,
rétention et attribution. Canary privé puis public borné.

### TTK-201 — TikTok Shorts

OAuth/audit, brouillon lorsque Direct Post est indisponible, publication quand
autorisée, processing et métriques réellement accessibles.

### ANA-201 — Performance jusqu'au revenu

Projection SQL déterministe de la production au call et au revenu ; définitions,
fenêtres, dénominateurs, coûts et capacités de chaque canal explicités.

## 11. Ordre de publication GitHub

1. Publier `NOO-101`, `NOO-102`, `NOO-103`, `OPS-101`.
2. Publier le lot 1 lorsque `NOO-101` est en revue et #17 fermé.
3. Publier le lot 2 lorsque la page Aujourd'hui est démontrable.
4. Publier le lot 3 seulement après un post LinkedIn simulé réconcilié.
5. Publier le lot 4 seulement après ingestion d'une interaction simulée.
6. Les tickets P1/P2 restent dans ce backlog jusqu'au succès de `PTC-101`.

Le kanban doit avoir au plus deux tickets produit `In progress` simultanément,
hors bug ou benchmark. Une tranche ne passe à `Done` que lorsque sa preuve
visible et ses tests sont attachés à l'issue.
