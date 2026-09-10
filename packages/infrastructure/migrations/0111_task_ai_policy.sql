CREATE TABLE task_ai_contexts (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 task_key text NOT NULL, policy jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_id, task_key)
);
CREATE TABLE instance_ai_runtime_defaults (
 id boolean PRIMARY KEY DEFAULT true CHECK (id = true), policy jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN ai_policy jsonb;
ALTER TABLE jobs ADD COLUMN ai_task_key text;
CREATE INDEX jobs_ai_task_key_idx ON jobs(workspace_id, ai_task_key) WHERE ai_task_key IS NOT NULL;
--> statement-breakpoint
-- Resolve references without copying credentials into a task snapshot.
CREATE FUNCTION noosphere_resolve_ai_routes(routes jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_agg(
   CASE WHEN c.id IS NULL THEN r.value
   ELSE r.value || jsonb_build_object('connectionVersion', c.version,
     'reasoningEffort', coalesce(m.reasoning_effort, r.value->>'reasoningEffort')) END
   ORDER BY r.ordinality), '[]'::jsonb)
 FROM jsonb_array_elements(coalesce(routes, '[]'::jsonb)) WITH ORDINALITY AS r(value, ordinality)
 LEFT JOIN instance_ai_connections c ON c.id::text = r.value->>'connectionId' AND c.provider = r.value->>'provider'
 LEFT JOIN instance_ai_models m ON m.connection_id = c.id AND m.model = r.value->>'model'
   AND m.connection_version = c.version AND m.status = 'ready' AND c.authentication_session_id IS NULL
$$;
--> statement-breakpoint
CREATE FUNCTION noosphere_capture_ai_policy(workspace uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
 settings workspace_ai_settings%ROWTYPE;
 default_route jsonb;
 defaults jsonb;
 capabilities jsonb;
 research_routes jsonb;
 research_models jsonb;
 environment_policy jsonb;
BEGIN
 SELECT * INTO settings FROM workspace_ai_settings WHERE workspace_id = workspace;
 SELECT policy INTO environment_policy FROM instance_ai_runtime_defaults WHERE id = true;
 SELECT jsonb_build_object('connectionId', c.id, 'connectionVersion', c.version,
   'provider', c.provider, 'model', d.model, 'reasoningEffort', coalesce(m.reasoning_effort, 'low'))
 INTO default_route FROM instance_ai_defaults d JOIN instance_ai_connections c ON c.id = d.connection_id
 LEFT JOIN instance_ai_models m ON m.connection_id = c.id AND m.model = d.model;
 defaults := coalesce(settings.model_routing->'defaultRoutes', '[]'::jsonb);
 IF jsonb_array_length(defaults) = 0 AND default_route IS NOT NULL THEN defaults := jsonb_build_array(default_route); END IF;
 IF jsonb_array_length(defaults) = 0 AND default_route IS NULL THEN defaults := coalesce(environment_policy->'defaultRoutes', '[]'::jsonb); END IF;
 defaults := noosphere_resolve_ai_routes(defaults);
 SELECT coalesce(jsonb_object_agg(key, noosphere_resolve_ai_routes(value)), '{}'::jsonb)
 INTO capabilities FROM jsonb_each(coalesce(settings.model_routing->'capabilityRoutes', '{}'::jsonb));
 research_routes := capabilities->'icp_research';
 IF research_routes IS NULL OR jsonb_array_length(research_routes) = 0 THEN research_routes := defaults; END IF;
 SELECT coalesce(jsonb_agg(value->>'model'), '[]'::jsonb) INTO research_models FROM jsonb_array_elements(research_routes);
 RETURN jsonb_build_object('defaultRoutes', defaults, 'capabilityRoutes', capabilities,
   'researchModels', CASE WHEN jsonb_array_length(research_models) > 0 THEN research_models ELSE coalesce(settings.research_models, environment_policy->'researchModels', '[]'::jsonb) END,
   'synthesisModels', CASE WHEN jsonb_array_length(research_models) > 0 THEN research_models ELSE coalesce(settings.synthesis_models, environment_policy->'synthesisModels', '[]'::jsonb) END);
END
$$;
--> statement-breakpoint
CREATE FUNCTION noosphere_pin_job_ai_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_policy jsonb;
BEGIN
 -- A research run spans many queue rows, including manual resumes with a new correlation ID.
 -- Other run-based processors retain their selection on retry/re-enqueue too.
 NEW.ai_task_key := CASE WHEN jsonb_typeof(NEW.payload->'runId') = 'string'
   THEN split_part(NEW.type, '.', 1) || ':run:' || (NEW.payload->>'runId') ELSE 'job:' || NEW.id::text END;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text || ':' || NEW.ai_task_key, 0));
 INSERT INTO task_ai_contexts(workspace_id, task_key, policy)
 VALUES (NEW.workspace_id, NEW.ai_task_key, noosphere_capture_ai_policy(NEW.workspace_id))
 ON CONFLICT (workspace_id, task_key) DO NOTHING;
 SELECT policy INTO previous_policy FROM task_ai_contexts
 WHERE workspace_id = NEW.workspace_id AND task_key = NEW.ai_task_key;
 -- Context survives queue retention and cannot be replaced by a producer-supplied policy.
 NEW.ai_policy := previous_policy;
 RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER jobs_pin_ai_policy BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION noosphere_pin_job_ai_policy();
