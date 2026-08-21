# Canary LinkedIn borné

Ce runbook est le seul chemin autorisé pour le canary `PTC-IN-LI-001`. Il ne
doit jamais être utilisé avec un contenu ou un compte seulement « supposé »
autorisé.

## 1. Préparer les valeurs exactes

Définir dans l’environnement d’exécution, sans les committer :

```bash
NOOSPHERE_PTC_MODE=preflight
NOOSPHERE_PTC_WORKSPACE_SLUG=ignition-ai
NOOSPHERE_PTC_ASSET_ID=<uuid de l'asset prêt>
NOOSPHERE_PTC_AUTHORIZED_ACCOUNT_ID=<id provider LinkedIn autorisé>
NOOSPHERE_PTC_AUTHORIZED_CONTENT_SHA256=<sha256 exact autorisé>
NOOSPHERE_PTC_RUN_ID=<uuid stable du canary>
NOOSPHERE_PTC_REPORT_PATH=/var/lib/noosphere/evidence/ptc-101.json
```

Le runtime doit aussi posséder `DATABASE_URL`, `UNIPILE_DSN`,
`UNIPILE_API_KEY`, `OUTBOUND_API_URL` et une session owner via
`NOOSPHERE_PTC_SESSION_COOKIE` ou les identifiants bootstrap.

## 2. Préflight sans écriture

```bash
bun run canary:linkedin
```

Le préflight relit toute la chaîne stratégie → idée → source → brief → asset,
recalcule le hash et fait uniquement un GET de capacité Unipile. Une différence
arrête le run avant toute mutation.

## 3. Autoriser une publication unique

Après validation explicite par Salim du compte et du texte correspondant au
hash :

```bash
NOOSPHERE_PTC_MODE=publish \
NOOSPHERE_PTC_CONFIRM=PUBLISH_ONE_AUTHORIZED_LINKEDIN_CANARY \
bun run canary:linkedin
```

Le request key est `ptc-101:<run-id>:publication`. Rejouer exactement ce run ne
doit pas créer une seconde publication.

## 4. Redémarrage et interaction contrôlée

1. conserver l’ID de publication du rapport ;
2. redémarrer le worker général avec le mécanisme normal de déploiement ;
3. rejouer le mode `publish` avec le même run ID ;
4. vérifier que l’ID reste identique et que le nombre de posts provider
   distincts reste un ;
5. depuis le compte LinkedIn test convenu, publier un commentaire réel dont
   l’identité exacte existe dans le CRM ;
6. laisser le sync créer le signal et la conversation ;
7. répondre depuis Noosphere, puis réserver via le lien/agenda prévu.

La preuve de redémarrage doit être jointe au rapport d’exploitation. La variable
`NOOSPHERE_PTC_RESTART_PROOF` reçoit ensuite l’ID de publication uniquement lors
de la vérification finale ; elle ne remplace pas les logs de redémarrage.

## 5. Verdict

```bash
NOOSPHERE_PTC_MODE=verify \
NOOSPHERE_PTC_CONFIRM=PUBLISH_ONE_AUTHORIZED_LINKEDIN_CANARY \
NOOSPHERE_PTC_PUBLICATION_ID=<uuid> \
NOOSPHERE_PTC_RESTART_PROOF=<même uuid> \
bun run canary:linkedin
```

Le code de sortie vaut `0` uniquement pour `product_verified`. Il vaut `2` si
une continuation L4 manque. Le rapport est expurgé : aucun texte, cookie ou
secret provider n’y est persisté.
