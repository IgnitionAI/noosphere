WITH workspace_max AS (
	SELECT workspace_id, MAX(version) AS max_version FROM icp_versions GROUP BY workspace_id
), missing_base AS (
	SELECT p.*, COALESCE(wm.max_version, 0) AS max_version
	FROM icp_proposals p
	JOIN product_research_runs r ON r.workspace_id = p.workspace_id AND r.id = p.run_id
	LEFT JOIN icp_versions existing ON existing.workspace_id = p.workspace_id AND existing.proposal_id = p.id
	LEFT JOIN workspace_max wm ON wm.workspace_id = p.workspace_id
	WHERE COALESCE((r.brief->>'researchVersion')::integer, 1) >= 2
		AND r.status IN ('completed', 'partial', 'ready_for_review')
		AND existing.id IS NULL
), missing AS (
	SELECT missing_base.*,
		max_version + ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, run_id, rank) AS next_version
	FROM missing_base
)
INSERT INTO icp_versions (
	id, workspace_id, run_id, proposal_id, version, name, confidence, criteria,
	buying_committee, problems, signals, exclusions, unknowns,
	unresolved_contradictions, blocked_findings, published_by, published_at
)
SELECT
	md5(m.id::text || ':version')::uuid,
	m.workspace_id, m.run_id, m.id, m.next_version::integer, m.name, m.confidence,
	m.criteria, m.buying_committee, m.problems, m.signals, m.exclusions, m.unknowns,
	'[]'::jsonb, '[]'::jsonb, NULL, COALESCE(m.updated_at, now())
FROM missing m
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO sequences (id, workspace_id, name, description, status, created_by, created_at, updated_at)
SELECT md5(v.id::text || ':sequence')::uuid, v.workspace_id,
	left('Séquence — ' || v.name, 300),
	'Brouillon généré automatiquement pour cet ICP. À relire avant toute publication.',
	'draft', NULL, v.published_at, v.published_at
FROM icp_versions v
LEFT JOIN campaigns c ON c.workspace_id = v.workspace_id AND c.icp_version_id = v.id
WHERE c.id IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO prospect_discovery_runs (
	id, workspace_id, icp_version_id, provider, filters, status, candidate_count, created_by, created_at
)
SELECT md5(v.id::text || ':discovery')::uuid, v.workspace_id, v.id, 'unipile',
	jsonb_build_object(
		'api', 'classic', 'category', 'people',
		'keywords', trim(concat_ws(' ',
			COALESCE(v.criteria->'sectors'->>0, v.criteria->'industries'->>0, ''),
			COALESCE(v.buying_committee->>0, '')
		)),
		'limit', 20, 'enrichContacts', true
	),
	'running', 0, NULL, v.published_at
FROM icp_versions v
LEFT JOIN campaigns c ON c.workspace_id = v.workspace_id AND c.icp_version_id = v.id
WHERE c.id IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO campaigns (
	id, workspace_id, icp_version_id, name, status, sequence_id, discovery_run_id,
	prospect_count, created_at, updated_at
)
SELECT md5(v.id::text || ':campaign')::uuid, v.workspace_id, v.id,
	left('Campagne — ' || v.name, 300), 'draft',
	md5(v.id::text || ':sequence')::uuid,
	md5(v.id::text || ':discovery')::uuid,
	0, v.published_at, v.published_at
FROM icp_versions v
LEFT JOIN campaigns c ON c.workspace_id = v.workspace_id AND c.icp_version_id = v.id
WHERE c.id IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO sequence_steps (
	id, workspace_id, sequence_id, position, kind, delay_days, window_start, window_end,
	subject, body, fallback_kind
)
SELECT
	md5(c.icp_version_id::text || ':step:' || step.position::text)::uuid,
	c.workspace_id, c.sequence_id, step.position, step.kind::sequence_step_kind,
	step.delay_days, step.window_start, step.window_end, step.subject, step.body,
	step.fallback_kind::sequence_step_kind
FROM campaigns c
CROSS JOIN (VALUES
	(1, 'manual_task', 0, NULL, NULL, NULL,
	 'Vérifier le score ICP, la preuve et le signal d’achat de {{firstName}} chez {{companyName}} avant tout contact.', NULL),
	(2, 'linkedin_invite', 0, '09:00', '17:30', NULL,
	 'Bonjour {{firstName}}, j’ai regardé le contexte de {{companyName}} autour de {{icpName}}. Ouvert à un échange ?', 'email'),
	(3, 'email', 1, '09:00', '17:30', '{{companyName}} — {{icpName}}',
	 'Bonjour {{firstName}},\n\nEn regardant {{companyName}}, j’ai identifié un contexte qui semble proche de {{icpName}}. Je préfère valider le besoin avec vous plutôt que présumer de vos priorités.\n\nSeriez-vous disponible pour un échange court ?\n\nBien à vous,\n{{senderName}}', NULL),
	(4, 'whatsapp', 5, '09:00', '17:30', NULL,
	 'Bonjour {{firstName}}, ici {{senderName}}. Je vous ai écrit au sujet de {{icpName}} chez {{companyName}}. Dites-moi simplement si ce sujet n’est pas pertinent.', NULL)
) AS step(position, kind, delay_days, window_start, window_end, subject, body, fallback_kind)
LEFT JOIN sequence_steps existing
	ON existing.workspace_id = c.workspace_id
	AND existing.sequence_id = c.sequence_id
	AND existing.position = step.position
WHERE existing.id IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO jobs (
	id, workspace_id, type, payload, idempotency_key, correlation_id,
	status, attempts, max_attempts, available_at
)
SELECT md5(c.id::text || ':initial-job')::uuid, c.workspace_id,
	'prospect.discovery.execute',
	jsonb_build_object('workspaceId', c.workspace_id, 'runId', c.discovery_run_id),
	c.id::text || ':initial', 'campaign:' || c.id::text,
	'pending', 0, 3, now()
FROM campaigns c
JOIN prospect_discovery_runs d ON d.workspace_id = c.workspace_id AND d.id = c.discovery_run_id
WHERE d.status = 'running'
ON CONFLICT DO NOTHING;
