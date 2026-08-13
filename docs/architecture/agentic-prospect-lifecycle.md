# Cycle agentique d’un prospect

La séquence demeure une stratégie autorisée (canal, nombre d’étapes, fenêtres,
contenu, fréquence). `LangChainProspectDecisionAgent` choisit ensuite une
action structurée parmi `send`, `wait`, `research`, `pause`, `stop`, `handoff`.
Le modèle ne touche jamais la base ni un provider; le runner charge un état
tenant-scoped et le policy guard pur tranche.

L’état transmis inclut contact, campagne/mode, action prévue, messages récents,
touches déjà envoyées et suppression. Le premier modèle de recherche du
workspace (fallback `PROSPECT_DECISION_MODEL`, puis K3) est le modèle principal
de réflexion avec reasoning maximal. La sortie Zod est obtenue via `createAgent` et
`toolStrategy`; aucune sortie libre n’est appliquée.

Une action `wait` ou `research` crée une nouvelle décision avec date et raison.
`send` crée soit une approbation dry-run, soit un job d’envoi. `stop/pause`
annule les actions et l’enrollment. `handoff` crée un item visible par un
opérateur. Chaque transition produit un outbox event.

La fiche prospect affiche la prochaine décision, son échéance, sa raison, ses
tentatives, l’erreur et le correlation ID. L’historique ne remplace ni la
conversation ni le CRM; il explique uniquement le pilotage outbound.

Le contrôle « Réévaluer maintenant · dry-run » crée une vraie décision et un
job tenant-scoped. Le runtime produit et persiste sa proposition et sa policy,
mais `simulationOnly=true` interdit tout envoi, recherche ou handoff externe.
