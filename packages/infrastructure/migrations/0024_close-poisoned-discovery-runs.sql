WITH poisoned_jobs AS (
	SELECT DISTINCT CASE jsonb_typeof(payload)
		WHEN 'object' THEN payload->>'runId'
		WHEN 'string' THEN ((payload #>> '{}')::jsonb)->>'runId'
		ELSE NULL
	END AS run_id
	FROM jobs
	WHERE type = 'prospect.discovery.execute'
		AND status = 'dead_lettered'
		AND last_error_message = 'INVALID_PROSPECT_DISCOVERY_JOB'
)
UPDATE prospect_discovery_runs d
SET status = 'failed',
	error_code = 'INVALID_PROSPECT_DISCOVERY_JOB',
	error_message = 'The queued payload was malformed before the JSONB serialization fix.',
	completed_at = now()
FROM poisoned_jobs p
WHERE p.run_id = d.id::text AND d.status = 'running';
