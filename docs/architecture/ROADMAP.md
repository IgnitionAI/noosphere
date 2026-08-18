# Roadmap d’implémentation

Le chemin produit canonique est décrit dans
[`docs/product/SIMPLE_LOOP.md`](../product/SIMPLE_LOOP.md). Cette roadmap
remplace l’ancien découpage par écrans et par files d’approbation.

## Boucle livrée

1. **ICP** — lecture produit, recherche sourcée, audit adversarial et
   publication automatique des ICP valides.
2. **Campagnes** — choix des canaux selon leur source de données, création de
   campagnes mono-canal, sourcing, scoring, personnalisation, envoi et relance.
3. **Conversations** — miroir durable des comptes LinkedIn, email et WhatsApp,
   qualification et Setter en campagne, reprise humaine immédiate.
4. **Rendez-vous** — proposition de créneaux, réservation idempotente,
   historique et opportunité commerciale.

Le parcours normal ne contient aucune approbation. Les suppressions, quotas,
fenêtres horaires, comptes dégradés et sujets sensibles restent des arrêts
déterministes localisés.

## Validation avant déploiement VPS

- exécuter la suite complète sur PostgreSQL et le crawler ;
- valider le build de production et le compose sans Docling ;
- effectuer un canary fournisseur sans envoi réel, puis un canary live borné ;
- vérifier le webhook public, le rattrapage de l’inbox et la reprise après
  redémarrage ;
- réserver puis annuler un rendez-vous de test sur le calendrier cible ;
- mesurer CPU, mémoire, latence et saturation sur le VPS retenu.

## Après le premier déploiement

- suivre les taux de découverte, identité vérifiée, envoi, réponse et
  rendez-vous par ICP et canal ;
- ajuster les budgets quotidiens sans introduire de plafond global de sourcing ;
- renforcer les sources gratuites de données d’entreprise et les signaux
  d’intention ;
- ajouter les capacités avancées uniquement lorsqu’elles améliorent le nombre
  de rendez-vous ou la fiabilité de la boucle.

## Hors chemin normal

- éditeur de workflow arbitraire ;
- warmup email maison ;
- facturation, devis, contrats et delivery client ;
- publication d’une affirmation non sourcée ;
- réponse automatique à une conversation hors campagne ;
- accès direct du modèle à un provider ou à un secret.
