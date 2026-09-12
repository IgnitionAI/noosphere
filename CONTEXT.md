# Ignition Outbound

Ignition Outbound organise une prospection B2B multi-workspace, depuis la
recherche de marché jusqu’au revenu, sans déléguer les décisions commerciales
sensibles aux automatisations.

## Recherche produit

**Mission de recherche produit**:
Étude bornée d’un produit et de son marché qui produit des propositions d’ICP
sourcées sans lancer de prospection ni publier automatiquement un ICP.
_Avoid_: Lecture produit, analyse ICP

**Étape de recherche**:
Phase ordonnée et reprenable de la mission, exécutée par un rôle d’agent défini.
_Avoid_: Tâche IA, sous-agent

**Checkpoint de recherche**:
Résultat durable d’une étape qui permet de reprendre la mission sans recalculer
les étapes validées.
_Avoid_: Cache, sauvegarde temporaire

**Preuve de marché**:
Passage traçable provenant d’une source publique ou d’un document fourni, avec
provenance et empreinte.
_Avoid_: Connaissance, résultat web

**Finding**:
Affirmation de recherche assortie d’un niveau de confiance et de preuves, ou
explicitement marquée comme hypothèse.
_Avoid_: Fait, insight

**Proposition ICP**:
Segment acheteur recommandé par une mission, encore modifiable et impropre au
sourcing tant qu’il n’a pas été publié dans une `ICPVersion`.
_Avoid_: ICP, segment validé

## Pilotage par agent

**Préparation d’acquisition**:
Ensemble de livrables Inbound et Outbound issus d’un produit et d’une mission de recherche, encore soumis aux validations nécessaires avant diffusion.
_Avoid_: Campagne envoyée, acquisition terminée

**Stratégie éditoriale**:
Choix des sujets, audiences et rythmes de contenu ancrés dans une offre et un ICP identifiés. Son activation ne signifie pas qu’un contenu a été publié.
_Avoid_: Post, campagne Outbound
