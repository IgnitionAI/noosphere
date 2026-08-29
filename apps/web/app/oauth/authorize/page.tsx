import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession, listWorkspaces } from "@/lib/api";
import {
  McpOAuthConsentError,
  createMcpOAuthConsentGateway,
  parseMcpOAuthAuthorizationRequest,
  type McpOAuthAuthorizationRequest,
} from "@/lib/mcp-oauth-consent";
import { decideMcpAuthorization, selectMcpOAuthWorkspace } from "./actions";
import { mcpOAuthConsentGateway } from "./gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autorisation MCP" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function McpOAuthAuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(loginNext(query))}`);

  const workspaceSlug = scalar(query.workspace_slug) ?? scalar(query.workspace);
  if (!workspaceSlug) {
    return <WorkspacePicker query={query} />;
  }

  let request: McpOAuthAuthorizationRequest;
  try {
    request = parseMcpOAuthAuthorizationRequest({ ...query, workspace_slug: workspaceSlug });
  } catch (error) {
    return <OAuthError error={error} />;
  }

  try {
    const consent = await mcpOAuthConsentGateway.getConsent(request);
    const decide = decideMcpAuthorization.bind(null, request);
    return (
      <main className="grid min-h-screen place-items-center bg-canvas p-5">
        <section className="panel w-full max-w-xl p-7 sm:p-9" aria-labelledby="oauth-title">
          <div className="badge badge-signal w-fit"><ShieldCheck aria-hidden size={14} /> Autorisation sécurisée</div>
          <h1 id="oauth-title" className="mt-5 text-2xl font-semibold tracking-tight text-ink">Autoriser {consent.client.clientName}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Cette application demande un accès MCP limité au workspace <strong className="text-ink">{consent.client.workspaceSlug}</strong>.
          </p>
          <div className="mt-6 grid gap-3 rounded-lg border border-line bg-slate-50 p-4 text-sm">
            <div><span className="text-muted">Workspace</span><p className="font-semibold text-ink">{consent.client.workspaceSlug}</p></div>
            <div><span className="text-muted">Redirection vérifiée</span><p className="break-all font-mono text-xs text-ink">{consent.client.redirectUri}</p></div>
            <div>
              <span className="text-muted">Permissions demandées</span>
              <ul className="mt-1 list-inside list-disc text-ink">
                {consent.requestedScopes.map((scope) => <li key={scope}>{scope}</li>)}
              </ul>
            </div>
          </div>
          <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted"><ShieldCheck aria-hidden className="mt-0.5 shrink-0 text-emerald-600" size={15} /> Aucun access token ni refresh token n’est transmis à cette page. Seul un code à usage unique sera redirigé après votre accord.</p>
          <form action={decide} className="mt-7 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="response_type" value={request.responseType} />
            <input type="hidden" name="client_id" value={request.clientId} />
            <input type="hidden" name="redirect_uri" value={request.redirectUri} />
            <input type="hidden" name="state" value={request.state} />
            <input type="hidden" name="code_challenge" value={request.codeChallenge} />
            <input type="hidden" name="code_challenge_method" value={request.codeChallengeMethod} />
            <input type="hidden" name="scope" value={request.scope} />
            {request.resource ? <input type="hidden" name="resource" value={request.resource} /> : null}
            <input type="hidden" name="workspace_slug" value={request.workspaceSlug} />
            <button className="button button-primary" name="decision" value="approve" type="submit"><CheckCircle2 aria-hidden size={16} /> Autoriser</button>
            <button className="button button-ghost" name="decision" value="deny" type="submit"><XCircle aria-hidden size={16} /> Refuser</button>
          </form>
        </section>
      </main>
    );
  } catch (error) {
    return <OAuthError error={error} />;
  }
}

async function WorkspacePicker({ query }: { query: SearchParams }) {
  const workspaces = await listWorkspaces();
  const firstWorkspace = workspaces[0];
  if (!firstWorkspace) return <OAuthError error={new McpOAuthConsentError(403, "access_denied", "Aucun workspace actif n’est disponible.")} />;
  let base: Record<string, string>;
  try {
    base = {
      response_type: scalar(query.response_type) ?? "",
      client_id: scalar(query.client_id) ?? "",
      redirect_uri: scalar(query.redirect_uri) ?? "",
      state: scalar(query.state) ?? "",
      code_challenge: scalar(query.code_challenge) ?? "",
      code_challenge_method: scalar(query.code_challenge_method) ?? "",
      scope: scalar(query.scope) ?? "mcp:read",
      resource: scalar(query.resource) ?? "",
      workspace_slug: firstWorkspace.slug,
    };
    parseMcpOAuthAuthorizationRequest(base);
  } catch (error) {
    return <OAuthError error={error} />;
  }
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="panel w-full max-w-xl p-7 sm:p-9" aria-labelledby="workspace-title">
        <div className="badge badge-signal w-fit"><ShieldCheck aria-hidden size={14} /> Choisir un workspace</div>
        <h1 id="workspace-title" className="mt-5 text-2xl font-semibold tracking-tight text-ink">Sélectionner l’espace à autoriser</h1>
        <p className="mt-2 text-sm leading-6 text-muted">L’accès MCP sera limité à un seul workspace dont votre session est membre actif.</p>
        <form action={selectMcpOAuthWorkspace} className="mt-7 space-y-5">
          {Object.entries(base).map(([key, value]) => key === "workspace_slug" ? null : <input key={key} type="hidden" name={key} value={value} />)}
          <label className="block"><span className="mb-2 block text-xs font-semibold text-ink">Workspace actif</span><select className="control" name="workspace_slug" required defaultValue={firstWorkspace.slug}>{workspaces.map((workspace) => <option key={workspace.slug} value={workspace.slug}>{workspace.name} ({workspace.slug})</option>)}</select></label>
          <button className="button button-primary w-full" type="submit">Continuer</button>
        </form>
      </section>
    </main>
  );
}

function OAuthError({ error }: { error: unknown }) {
  const consentError = error instanceof McpOAuthConsentError ? error : new McpOAuthConsentError(400, "invalid_request", "La demande d’autorisation est invalide.");
  return <main className="grid min-h-screen place-items-center bg-canvas p-5"><section className="panel w-full max-w-xl p-7 sm:p-9" role="alert"><div className="badge w-fit border-red-200 bg-red-50 text-danger"><XCircle aria-hidden size={14} /> Autorisation impossible</div><h1 className="mt-5 text-2xl font-semibold text-ink">La demande ne peut pas être traitée</h1><p className="mt-3 text-sm leading-6 text-muted">{consentError.message}</p><p className="mt-5 font-mono text-xs text-muted">{consentError.oauthCode}</p></section></main>;
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function loginNext(query: SearchParams): string {
  const safe = new URLSearchParams();
  for (const key of ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource", "workspace_slug", "workspace"]) {
    const value = scalar(query[key]);
    if (value) safe.set(key, value);
  }
  return `/oauth/authorize${safe.toString() ? `?${safe.toString()}` : ""}`;
}
