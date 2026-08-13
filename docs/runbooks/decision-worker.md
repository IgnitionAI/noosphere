# Runbook du worker de décisions

## Démarrage

```bash
bun run db:migrate
bun run worker
```

Le worker consomme `prospect.decision.execute`. `WORKER_ONCE=1` exécute un
tick. `JOB_LEASE_MS`, `JOB_BATCH_SIZE` et `JOB_POLL_INTERVAL_MS` règlent la
prise de travail. `PROSPECT_DECISION_MODEL` sélectionne le modèle Kimi parmi
ceux autorisés comme fallback d'environnement; le premier modèle de recherche
enregistré pour le workspace reste prioritaire.

## Diagnostic

```sql
select pd.id, pd.status, pd.kind, pd.reason, pd.due_at, pd.attempts,
       pd.last_error_code, pd.correlation_id, j.status as job_status,
       j.locked_by, j.locked_until
from prospect_decisions pd
join jobs j on j.workspace_id = pd.workspace_id and j.id = pd.job_id
where pd.workspace_id = $1
order by pd.created_at desc;
```

Ne jamais forcer une action externe. Corriger la configuration, puis utiliser
la console de jobs pour un retry. Un lease expiré est automatiquement repris;
un dead letter conserve l’erreur dans la décision. Le correlation ID relie
décision, job, approval, dispatch et outbox.
