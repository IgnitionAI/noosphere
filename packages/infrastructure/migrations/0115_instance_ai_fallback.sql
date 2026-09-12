ALTER TABLE instance_ai_defaults ADD COLUMN fallback_connection_id uuid REFERENCES instance_ai_connections(id);
--> statement-breakpoint
ALTER TABLE instance_ai_defaults ADD COLUMN fallback_model text;
--> statement-breakpoint
ALTER TABLE instance_ai_defaults ADD CONSTRAINT instance_ai_fallback_pair CHECK ((fallback_connection_id IS NULL) = (fallback_model IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION noosphere_capture_ai_policy(workspace uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
 settings workspace_ai_settings%ROWTYPE;
 default_route jsonb;
 fallback_route jsonb;
 defaults jsonb;
 capabilities jsonb;
 research_routes jsonb;
 research_models jsonb;
 tier_routes jsonb;
 environment_policy jsonb;
BEGIN
 SELECT * INTO settings FROM workspace_ai_settings WHERE workspace_id = workspace;
 SELECT policy INTO environment_policy FROM instance_ai_runtime_defaults WHERE id = true;
 SELECT jsonb_build_object('connectionId', c.id, 'connectionVersion', c.version,
   'provider', c.provider, 'model', d.model, 'reasoningEffort', coalesce(m.reasoning_effort, 'low'))
 INTO default_route FROM instance_ai_defaults d JOIN instance_ai_connections c ON c.id = d.connection_id
 LEFT JOIN instance_ai_models m ON m.connection_id = c.id AND m.model = d.model;
 SELECT jsonb_build_object('connectionId', c.id, 'connectionVersion', c.version,
   'provider', c.provider, 'model', d.fallback_model, 'reasoningEffort', coalesce(m.reasoning_effort, 'low'))
 INTO fallback_route FROM instance_ai_defaults d JOIN instance_ai_connections c ON c.id = d.fallback_connection_id
 LEFT JOIN instance_ai_models m ON m.connection_id = c.id AND m.model = d.fallback_model;
 defaults := coalesce(settings.model_routing->'defaultRoutes', '[]'::jsonb);
 IF jsonb_array_length(defaults) = 0 AND default_route IS NOT NULL THEN defaults := jsonb_build_array(default_route) || CASE WHEN fallback_route IS NOT NULL THEN jsonb_build_array(fallback_route) ELSE '[]'::jsonb END; END IF;
 IF jsonb_array_length(defaults) = 0 AND default_route IS NULL THEN defaults := coalesce(environment_policy->'defaultRoutes', '[]'::jsonb); END IF;
 defaults := noosphere_resolve_ai_routes(defaults);
 SELECT coalesce(jsonb_object_agg(key, noosphere_resolve_ai_routes(value)), '{}'::jsonb)
 INTO capabilities FROM jsonb_each(coalesce(settings.model_routing->'capabilityRoutes', '{}'::jsonb));
 tier_routes := settings.model_routing->'researchTierRoutes';
 research_routes := capabilities->'icp_research';
 IF research_routes IS NULL OR jsonb_array_length(research_routes) = 0 THEN research_routes := defaults; END IF;
 SELECT coalesce(jsonb_agg(value->>'model'), '[]'::jsonb) INTO research_models FROM jsonb_array_elements(research_routes);
 RETURN jsonb_build_object('defaultRoutes', defaults, 'capabilityRoutes', capabilities,
   'researchModels', CASE WHEN tier_routes IS NOT NULL THEN settings.research_models WHEN jsonb_array_length(research_models) > 0 THEN research_models ELSE coalesce(settings.research_models, environment_policy->'researchModels', '[]'::jsonb) END,
   'synthesisModels', CASE WHEN tier_routes IS NOT NULL THEN settings.synthesis_models WHEN jsonb_array_length(research_models) > 0 THEN research_models ELSE coalesce(settings.synthesis_models, environment_policy->'synthesisModels', '[]'::jsonb) END)
   || CASE WHEN tier_routes IS NOT NULL THEN jsonb_build_object('researchTierRoutes', tier_routes) ELSE '{}'::jsonb END;
END
$$;
