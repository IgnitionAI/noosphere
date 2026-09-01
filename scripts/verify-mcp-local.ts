import { readFile, stat } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport, type FetchLike } from "@modelcontextprotocol/client";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { createDatabase } from "@outbound/infrastructure/database/client";
import type {
  McpLocalIdentityLabel,
  McpLocalRole,
  McpLocalScope,
} from "./write-mcp-local-client-config";
import { resolveMcpSmokeFixtureIds, type McpSmokeFixtureIds } from "./prepare-mcp-production-smoke";
import { validateLocalDatabaseUrl } from "./prepare-mcp-local";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[^\s\u0000-\u001f\u007f]{8,4096}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_.-]{0,79}$/;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CALLS = 256;
const RATE_LIMIT_MAX_COST = 100;
const RATE_LIMIT_PROBE_ATTEMPTS = RATE_LIMIT_MAX_COST + 1;
const MAX_ITEMS = 64;
const MAX_TEXT_BYTES = 16_384;
const MAX_URI_BYTES = 2_048;
const MAX_CORRELATION_BYTES = 128;
const SAFE_CORRELATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CURL_OUTPUT_BYTES = 64 * 1024;
const CURL_EXECUTABLE = "/usr/bin/curl";
const FOREIGN_HOST = "foreign.invalid";
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-06-18";
const REQUIRED_TOOLS = [
  "conversation_prepare_reply",
  "content_prepare_publication",
  "meeting_prepare_proposal",
  "campaign_prepare_activation",
  "approval_list",
  "approval_get",
  "approval_decide",
] as const;
const EXPECTED_RESOURCES = ["noosphere://runtime"] as const;

export interface McpLocalSdkIdentity extends McpLocalIdentityLabel {
  readonly token: string;
}

export interface McpLocalConnection {
  readonly endpoint: string;
  readonly resource: string;
  readonly caPath: string;
  readonly timeoutMs: number;
  readonly era?: "modern" | "legacy";
}

export interface McpLocalContentItem {
  readonly type: "text" | "image" | "resource";
  readonly text?: string;
  readonly mimeType?: string;
  readonly data?: string;
}

export interface McpLocalToolResult {
  readonly isError: boolean;
  readonly content: readonly McpLocalContentItem[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
}

export interface McpLocalSdkClient {
  initialize(): Promise<void>;
  listTools(): Promise<{ readonly tools: readonly { readonly name: string }[] }>;
  listResources(): Promise<{ readonly resources: readonly { readonly uri: string; readonly name?: string }[] }>;
  readResource(uri: string): Promise<{ readonly contents: readonly { readonly uri: string; readonly text?: string; readonly mimeType?: string }[] }>;
  /** Optional because some SDK revisions omit Client.ping after negotiation. */
  ping?: () => Promise<Readonly<Record<string, unknown>>>;
  /** Internal authenticated HTTPS fallback; never returns raw response text. */
  rawPing?: () => Promise<Readonly<Record<string, unknown>>>;
  callTool(name: string, args: Readonly<Record<string, string | number | boolean | null>>): Promise<McpLocalToolResult>;
  close(): Promise<void>;
}

export type McpLocalSdkFactory = (
  identity: McpLocalSdkIdentity,
  connection: McpLocalConnection,
  /** Internal test seam; the CLI never overrides the CA-bound fetch. */
  fetchImpl?: FetchLike,
) => Promise<McpLocalSdkClient>;

export type McpLocalFixtureIdName =
  | "foreignProposal"
  | "viewerProposal"
  | "foreignAggregate"
  | "viewerAggregate"
  | "revokedAccessToken";

export interface McpLocalDurableState {
  readonly intentions: number;
  readonly jobs: number;
  readonly outbox: number;
  readonly attempts: number;
  readonly terminalResults: number;
  /** Number of durable attempt markers crossing the provider boundary. */
  readonly providerBoundaryAttempts: number;
  readonly reconciliations?: number;
  /** Every real reader must return bounded row references; absence is invalid. */
  readonly refs: McpLocalDurableRefs;
  readonly terminalStatuses?: readonly string[];
  /** Proposal statuses are read from the durable row, never inferred. */
  readonly proposalStatuses?: readonly string[];
  /** Durable evidence that a generated effect used the local fake adapter. */
  readonly localFakeBoundaryVerified?: boolean;
}

export interface McpLocalDurableRefs {
  readonly proposalIds: readonly string[];
  readonly intentionIds: readonly string[];
  readonly jobIds: readonly string[];
  readonly outboxIds: readonly string[];
  readonly traceIds: readonly string[];
  readonly attemptTraceIds: readonly string[];
  readonly resultTraceIds: readonly string[];
  readonly reconciliationIds: readonly string[];
  readonly terminalStatuses: readonly string[];
}

export interface McpLocalDurableStateQueryInput {
  readonly fixtureIds: McpSmokeFixtureIds;
  readonly workspaceIds: readonly string[];
  /** Generated-effect scope required by every durable read. */
  readonly proposalId: string;
  readonly workspaceId: string;
}

export type McpLocalDurableStateQuery = (
  input: McpLocalDurableStateQueryInput,
) => Promise<McpLocalDurableState>;

export interface McpLocalDurableStateReaderOptions {
  readonly databaseUrl: string;
  readonly fixtureIds: McpSmokeFixtureIds;
  /** Identity labels are the authority for workspace selection; configuration order is ignored. */
  readonly identityLabels: readonly McpLocalIdentityLabel[];
  /** Deprecated compatibility input; when present it is set-compared only, never ordered or used for selection. */
  readonly workspaceIds?: readonly string[];
  /** Test seam; production uses the bounded PostgreSQL query below. */
  readonly query?: McpLocalDurableStateQuery;
}

export interface McpLocalDurableStateReader {
  readonly readProposal: (proposalId: string, workspaceId: string) => Promise<McpLocalDurableState>;
  readonly close: () => Promise<void>;
}

export interface McpLocalVerificationProbe {
  readonly kind: "malformed" | "body_limit" | "rate_limit" | "origin" | "audience" | "correlation";
}

export interface McpLocalVerificationProbeResult {
  readonly ok: boolean;
  readonly code: string;
}

export interface McpLocalEdgeProbeOptions {
  readonly identity: McpLocalSdkIdentity;
  readonly connection: McpLocalConnection;
  readonly fetchImpl?: FetchLike;
  /** Internal HTTPS seam; the CLI uses the CA-bound implementation below. */
  readonly httpsRequest?: McpLocalHttpsRequest;
  /** Internal seam for the Host/SNI probe; production uses the allowlisted curl transport. */
  readonly audienceRequest?: McpLocalAudienceRequest;
}

export interface McpLocalHttpsRequestOptions {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly ca: Buffer;
  /** Always derived from the validated endpoint; callers cannot override it. */
  readonly servername: string;
  readonly signal?: AbortSignal;
  readonly body?: string | Buffer;
}

export type McpLocalHttpsRequest = (
  url: URL,
  options: McpLocalHttpsRequestOptions,
) => Promise<Response>;

export interface McpLocalAudienceRequestOptions {
  readonly endpoint: URL;
  /** Explicitly derived from endpoint.hostname; never caller supplied. */
  readonly servername: string;
  readonly host: typeof FOREIGN_HOST;
  readonly caPath: string;
  readonly correlationId: string;
  readonly timeoutMs: number;
}

export type McpLocalAudienceRequest = (
  options: McpLocalAudienceRequestOptions,
) => Promise<Response>;

export type McpLocalEdgeProbe = (
  input: McpLocalVerificationProbe,
) => Promise<McpLocalVerificationProbeResult>;

export interface VerifyMcpLocalOptions {
  readonly configPath: string;
  readonly timeoutMs: number;
  readonly maxCalls: number;
  readonly fixtureIds: McpSmokeFixtureIds;
  readonly resolveFixtureId: (name: McpLocalFixtureIdName) => string;
  /** Reads only the generated proposal/workspace pair after prepare. */
  readonly readDurableStateForProposal: (proposalId: string, workspaceId: string) => Promise<McpLocalDurableState>;
  readonly sdkFactory: McpLocalSdkFactory;
  /** Edge probes are mandatory for a real verification run. */
  readonly probe: ((input: McpLocalVerificationProbe) => Promise<McpLocalVerificationProbeResult>) | undefined;
  /** Production-like verification must explicitly select the local fake worker. */
  readonly localFakeEnabled: true;
}

export interface McpLocalVerificationCheck {
  readonly name: string;
  readonly outcome: "pass" | "fail";
  readonly code: string;
}

export interface McpLocalVerificationReport {
  readonly correlationId: string;
  readonly protocol: { readonly modern: boolean; readonly legacy: boolean };
  readonly toolChecks: readonly McpLocalVerificationCheck[];
  readonly durableChecks: readonly McpLocalVerificationCheck[];
  /** Durable attempt-marker delta; this is not a provider-call counter. */
  readonly providerBoundaryAttempts: number;
  readonly effect?: McpLocalEffectEvidence;
  readonly durableRefs?: McpLocalDurableRefs;
  readonly fixtureIds: Readonly<Pick<McpSmokeFixtureIds, "proposal" | "aggregate">>;
  readonly redacted: true;
}

export interface McpLocalEffectEvidence {
  readonly kind: "content_publication";
  readonly proposalId: string;
  readonly approvalItemId: string;
  readonly providerBoundaryAttempts: number;
  readonly beforeRefs: McpLocalDurableRefs;
  readonly afterRefs: McpLocalDurableRefs;
  readonly outcomeTraceIds: readonly string[];
  readonly durableRefs: McpLocalDurableRefs;
  readonly status: string;
  readonly replayStable: boolean;
  readonly reconciliationStable: boolean;
  /** Internal snapshots used to build durable checks; never serialized. */
  readonly beforeState?: McpLocalDurableState;
  readonly afterState?: McpLocalDurableState;
  readonly localFakeBoundaryVerified?: boolean;
}

export class McpLocalVerificationError extends Error {
  readonly code: string;
  readonly report: McpLocalVerificationReport;

  constructor(code: string, report: McpLocalVerificationReport) {
    super(code);
    this.name = "McpLocalVerificationError";
    this.code = code;
    this.report = report;
  }
}

interface ParsedClientConfig {
  readonly resource: string;
  readonly caPath: string;
  readonly tokenFilePath: string;
  readonly identities: readonly McpLocalIdentityLabel[];
}

interface OpenClient {
  readonly client: McpLocalSdkClient;
  readonly identity: McpLocalSdkIdentity;
}

interface CallBudget {
  readonly call: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly remaining: () => number;
}

const DURABLE_STATUSES = new Set([
  "approval_required", "policy_denied", "queued", "accepted", "unknown",
  "reconciling", "delivered", "failed", "rejected", "invalidated",
]);

/**
 * Build the verifier's durable state reader. The default implementation uses
 * the existing PostgreSQL client and only selects the two proposal/workspace
 * pairs created by the local fixture. A query seam is intentionally available
 * for unit tests, while the CLI always uses the PostgreSQL branch.
 */
export function createMcpLocalDurableStateReader(
  options: McpLocalDurableStateReaderOptions,
): McpLocalDurableStateReader {
  validateMcpLocalDatabaseUrl(options.databaseUrl);
  const workspaceIds = workspaceIdsForIdentities(options.identityLabels);
  if (options.workspaceIds !== undefined) {
    const supplied = [...new Set(options.workspaceIds)];
    if (supplied.length !== workspaceIds.length || supplied.some((id) => !workspaceIds.includes(id))) {
      throw new Error("MCP_LOCAL_WORKSPACE_MATRIX_INVALID");
    }
  }
  const query = options.query ?? createPostgresDurableStateQuery(options.databaseUrl, workspaceIds as [string, string], options.fixtureIds);
  return {
    readProposal: async (proposalId, workspaceId) => {
      assertDurableUuid(proposalId, "MCP_LOCAL_DURABLE_PROPOSAL_ID_INVALID");
      assertDurableUuid(workspaceId, "MCP_LOCAL_DURABLE_WORKSPACE_ID_INVALID");
      if (!workspaceIds.includes(workspaceId)) throw new Error("MCP_LOCAL_DURABLE_WORKSPACE_SCOPE_INVALID");
      const fixtureIds = options.fixtureIds;
      const state = await query({ fixtureIds, workspaceIds, proposalId, workspaceId });
      validateDurableState(state);
      validateDurableRefs(state.refs);
      if (state.refs.proposalIds.length !== 1 || state.refs.proposalIds[0] !== proposalId) throw new Error("MCP_LOCAL_DURABLE_PROPOSAL_BINDING_INVALID");
      return state;
    },
    close: async () => {
      const close = (query as PostgresDurableQuery & { close?: () => Promise<void> }).close;
      await close?.();
    },
  };
}

type PostgresDurableQuery = McpLocalDurableStateQuery;

function createPostgresDurableStateQuery(
  databaseUrl: string,
  workspaceIds: readonly [string, string],
  fixtureIds: McpSmokeFixtureIds,
): PostgresDurableQuery {
  const database = createDatabase(databaseUrl);
  const query = (async ({ proposalId, workspaceId, workspaceIds }: McpLocalDurableStateQueryInput): Promise<McpLocalDurableState> => {
    if (!workspaceIds.includes(workspaceId)) throw new Error("MCP_LOCAL_DURABLE_WORKSPACE_SCOPE_INVALID");
    const proposalRows = await database.client`
      select id, workspace_id, status, job_id, reconciliation_id, aggregate_id
      from mcp_effect_proposals
      where workspace_id = ${workspaceId} and id = ${proposalId}
      order by workspace_id, id
    ` as Array<{ id: string; workspace_id: string; status: string; job_id: string | null; reconciliation_id: string | null; aggregate_id: string }>;
    if (proposalRows.length !== 1) throw new Error("MCP_LOCAL_DURABLE_PROPOSALS_MISSING");

    const intentionIds: string[] = [];
    const jobIds: string[] = [];
    const outboxIds: string[] = [];
    const traceIds: string[] = [];
    const attemptTraceIds: string[] = [];
    const resultTraceIds: string[] = [];
    const reconciliationIds: string[] = [];
    const terminalStatuses: string[] = [];
    const proposalStatuses: string[] = [];
    let localFakeBoundaryVerified: boolean | undefined;
    for (const proposal of proposalRows) {
      assertDurableUuid(proposal.id, "MCP_LOCAL_DURABLE_PROPOSAL_ID_INVALID");
      assertDurableUuid(proposal.workspace_id, "MCP_LOCAL_DURABLE_WORKSPACE_ID_INVALID");
      if (!DURABLE_STATUSES.has(proposal.status)) throw new Error("MCP_LOCAL_DURABLE_STATUS_INVALID");
      proposalStatuses.push(proposal.status);
      if (proposal.status === "delivered" || proposal.status === "failed" || proposal.status === "rejected" || proposal.status === "invalidated" || proposal.status === "policy_denied") {
        terminalStatuses.push(proposal.status);
      }
      const intentions = await database.client`
        select id, job_id, state
        from mcp_effect_intentions
        where workspace_id = ${proposal.workspace_id} and proposal_id = ${proposal.id}
        order by id
      ` as Array<{ id: string; job_id: string; state: string }>;
      const proposalJobIds: string[] = [];
      for (const intention of intentions) {
        assertDurableUuid(intention.id, "MCP_LOCAL_DURABLE_INTENTION_ID_INVALID");
        assertDurableUuid(intention.job_id, "MCP_LOCAL_DURABLE_JOB_ID_INVALID");
        if (!new Set(["queued", "started", "unknown", "completed"]).has(intention.state)) throw new Error("MCP_LOCAL_DURABLE_INTENTION_STATE_INVALID");
        intentionIds.push(intention.id);
        jobIds.push(intention.job_id);
        proposalJobIds.push(intention.job_id);
      }
      if (proposal.job_id !== null && intentions.some((intention) => intention.job_id !== proposal.job_id)) {
        throw new Error("MCP_LOCAL_DURABLE_JOB_BINDING_INVALID");
      }
      if (proposal.job_id !== null) {
        assertDurableUuid(proposal.job_id, "MCP_LOCAL_DURABLE_JOB_ID_INVALID");
        jobIds.push(proposal.job_id);
        proposalJobIds.push(proposal.job_id);
      }
      const uniqueJobIds = [...new Set(proposalJobIds)];
      for (const jobId of uniqueJobIds) {
        const jobs = await database.client`
          select id, type, status, workspace_id
          from jobs
          where workspace_id = ${proposal.workspace_id} and id = ${jobId}
        ` as Array<{ id: string; type: string; status: string; workspace_id: string }>;
        if (jobs.length !== 1 || jobs[0]!.type !== "mcp.external-effect.execute" || jobs[0]!.workspace_id !== proposal.workspace_id) {
          throw new Error("MCP_LOCAL_DURABLE_JOB_MISSING");
        }
      }
      const outboxes = await database.client`
        select id, payload
        from outbox_events
        where workspace_id = ${proposal.workspace_id}
          and aggregate_id = ${proposal.id}
          and event_type = 'McpExternalEffectExecutionRequested'
        order by id
      ` as Array<{ id: string; payload: unknown }>;
      for (const outbox of outboxes) {
        assertDurableUuid(outbox.id, "MCP_LOCAL_DURABLE_OUTBOX_ID_INVALID");
        validateDurableOutboxPayload(outbox.payload, outbox.id, proposal.workspace_id, proposal.id);
        outboxIds.push(outbox.id);
      }
      const traces = await database.client`
        select id, stage, redacted_payload
        from mcp_effect_traces
        where workspace_id = ${proposal.workspace_id} and proposal_id = ${proposal.id}
        order by sequence, id
      ` as Array<{ id: string; stage: string; redacted_payload: unknown }>;
      for (const trace of traces) {
        assertDurableUuid(trace.id, "MCP_LOCAL_DURABLE_TRACE_ID_INVALID");
        if (!["proposal", "approval", "policy", "outbox", "attempt", "result"].includes(trace.stage)) throw new Error("MCP_LOCAL_DURABLE_TRACE_STAGE_INVALID");
        traceIds.push(trace.id);
        if (trace.stage === "attempt") attemptTraceIds.push(trace.id);
        if (trace.stage === "result") resultTraceIds.push(trace.id);
      }
      const source = [fixtureIds.content.foreign, fixtureIds.content.viewer]
        .find((candidate) => candidate.publicationId === proposal.aggregate_id);
      if (source) {
        const publications = await database.client`
          select account_snapshot
          from content_publications
          where workspace_id = ${proposal.workspace_id} and id = ${source.publicationId}
        ` as Array<{ account_snapshot: unknown }>;
        const fakeAccounts = await database.client`
          select id
          from connected_accounts
          where workspace_id = ${proposal.workspace_id}
            and provider = 'unipile'
            and provider_account_id = ${source.providerAccountId}
            and status = 'connected'
            and encrypted_secret = 'local-fixture-no-provider'
          order by id
        ` as Array<{ id: string }>;
        const resultPayloads = traces.filter((trace) => trace.stage === "result").map((trace) => trace.redacted_payload);
        localFakeBoundaryVerified = publications.length === 1
          && publicationAccountId(publications[0]!.account_snapshot) === source.providerAccountId
          && fakeAccounts.length === 1
          && resultPayloads.length === 1
          && resultPayloads.every((payload) => resultCode(payload) === "DELIVERED");
      }
      const reconciliations = await database.client`
        select id, status
        from mcp_effect_reconciliations
        where workspace_id = ${proposal.workspace_id} and proposal_id = ${proposal.id}
        order by id
      ` as Array<{ id: string; status: string }>;
      for (const reconciliation of reconciliations) {
        assertDurableUuid(reconciliation.id, "MCP_LOCAL_DURABLE_RECONCILIATION_ID_INVALID");
        if (!["pending", "searching", "matched", "not_found", "ambiguous", "error"].includes(reconciliation.status)) throw new Error("MCP_LOCAL_DURABLE_RECONCILIATION_STATUS_INVALID");
        reconciliationIds.push(reconciliation.id);
      }
      if (proposal.reconciliation_id !== null
        && !reconciliations.some((reconciliation) => reconciliation.id === proposal.reconciliation_id)) {
        throw new Error("MCP_LOCAL_DURABLE_RECONCILIATION_BINDING_INVALID");
      }
    }
    const refs: McpLocalDurableRefs = {
      proposalIds: proposalRows.map((row) => row.id),
      intentionIds: uniqueStrings(intentionIds),
      jobIds: uniqueStrings(jobIds),
      outboxIds: uniqueStrings(outboxIds),
      traceIds: uniqueStrings(traceIds),
      attemptTraceIds: uniqueStrings(attemptTraceIds),
      resultTraceIds: uniqueStrings(resultTraceIds),
      reconciliationIds: uniqueStrings(reconciliationIds),
      terminalStatuses: [...new Set(terminalStatuses)].sort(),
    };
    return {
      intentions: refs.intentionIds.length,
      jobs: refs.jobIds.length,
      outbox: refs.outboxIds.length,
      attempts: refs.attemptTraceIds.length,
      terminalResults: refs.resultTraceIds.length,
      providerBoundaryAttempts: refs.attemptTraceIds.length,
      reconciliations: refs.reconciliationIds.length,
      refs,
      proposalStatuses,
      ...(localFakeBoundaryVerified !== undefined ? { localFakeBoundaryVerified } : {}),
    };
  }) as PostgresDurableQuery & { close: () => Promise<void> };
  query.close = () => database.close();
  return query;
}

/** Execute the complete bounded local MCP journey and return only safe projections. */
export async function verifyMcpLocal(options: VerifyMcpLocalOptions): Promise<McpLocalVerificationReport> {
  const correlationId = crypto.randomUUID();
  const reportBase = (toolChecks: readonly McpLocalVerificationCheck[] = [], durableChecks: readonly McpLocalVerificationCheck[] = [], providerBoundaryAttempts = 0, durableRefs?: McpLocalDurableRefs, effect?: McpLocalEffectEvidence): McpLocalVerificationReport => ({
    correlationId,
    protocol: { modern: false, legacy: false },
    toolChecks,
    durableChecks,
    providerBoundaryAttempts: boundedCounter(providerBoundaryAttempts) ?? 0,
    fixtureIds: safeFixtureIds(options.fixtureIds),
    ...(durableRefs ? { durableRefs: safeDurableRefs(durableRefs) } : {}),
    ...(effect ? { effect: safeEffectEvidence(effect) } : {}),
    redacted: true,
  });

  const opened: OpenClient[] = [];
  let protocol = { modern: false, legacy: false };
  const toolChecks: McpLocalVerificationCheck[] = [];
  const durableChecks: McpLocalVerificationCheck[] = [];
  try {
    const budget = createCallBudget(options.timeoutMs, options.maxCalls);
    validateOptions(options);
    validateFixtureIds(options.fixtureIds, options.resolveFixtureId);
    const config = await loadClientConfig(options.configPath);
    const identities = await loadSdkIdentities(config);
    const reviewer = requireIdentity(identities, "reviewer");
    const operator = requireIdentity(identities, "operator");
    const viewer = requireIdentity(identities, "viewer");
    const revoked: McpLocalSdkIdentity = { ...viewer, token: viewer.revokedToken };
    const modern = await openClient(options, reviewer, config, "modern", budget, opened);
    const modernResult = await protocolJourney(modern.client, budget, toolChecks, "modern");
    protocol = { ...protocol, modern: modernResult.ok };

    const legacy = await openClient(options, viewer, config, "legacy", budget, opened);
    const legacyResult = await protocolJourney(legacy.client, budget, toolChecks, "legacy");
    protocol = { ...protocol, legacy: legacyResult.ok };

    const operatorClient = await openClient(options, operator, config, "modern", budget, opened);
    await budget.call(() => operatorClient.client.initialize());
    const effect = await verifyToolMatrix(operatorClient.client, modern.client, legacy.client, revoked, config, options, budget, opened, toolChecks);
    await verifyEdgeProbes(options, budget, toolChecks);

    if (!effect?.beforeState || !effect.afterState) throw new Error("MCP_LOCAL_EFFECT_STATE_MISSING");
    appendDurableChecks(durableChecks, effect.beforeState, effect.afterState);
    return {
      ...reportBase(toolChecks, durableChecks, effect.providerBoundaryAttempts, effect.durableRefs, effect),
      protocol,
    };
  } catch (error) {
    const code = error instanceof McpLocalVerificationError && SAFE_CODE.test(error.code)
      ? error.code
      : error instanceof Error && SAFE_CODE.test(error.message) ? error.message : "MCP_LOCAL_VERIFICATION_FAILED";
    throw new McpLocalVerificationError(code, {
      ...reportBase(toolChecks, durableChecks),
      protocol,
    });
  } finally {
    await closeClients(opened);
  }
}

async function readTrustedCa(path: string): Promise<Buffer> {
  try {
    const details = await stat(path);
    if (!details.isFile() || (details.mode & 0o777) !== 0o600) throw new Error("MCP_LOCAL_CA_INVALID");
    const certificate = await readFile(path);
    if (certificate.length === 0 || certificate.length > 64 * 1024 || !certificate.toString("ascii").includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("MCP_LOCAL_CA_INVALID");
    }
    return certificate;
  } catch (error) {
    if (error instanceof Error && error.message === "MCP_LOCAL_CA_INVALID") throw error;
    throw new Error("MCP_LOCAL_CA_INVALID");
  }
}

/** Fetch implementation that keeps the local CA in the TLS agent, rather than
 * relying on `-k` or a process-global trust-store mutation. */
function createCaBoundFetch(ca: Buffer, requestImpl: McpLocalHttpsRequest = requestMcpOverHttps): FetchLike {
  return async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : input.toString());
    if (url.protocol !== "https:") throw new Error("MCP_LOCAL_CA_ENDPOINT_INVALID");
    const headers = new Headers(init.headers);
    const body = init.body;
    let requestBody: string | Buffer | undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === "string" || Buffer.isBuffer(body)) requestBody = body;
      else throw new Error("MCP_LOCAL_REQUEST_BODY_INVALID");
    }
    return requestImpl(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      ca,
      servername: url.hostname,
      ...(init.signal ? { signal: init.signal } : {}),
      ...(requestBody === undefined ? {} : { body: requestBody }),
    });
  };
}

function requestMcpOverHttps(url: URL, options: McpLocalHttpsRequestOptions): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: options.method,
      headers: options.headers,
      ca: options.ca,
      servername: options.servername,
      ...(options.signal ? { signal: options.signal } : {}),
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue;
        responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          response.on("data", (chunk: Buffer | string) => controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
          response.on("end", () => controller.close());
          response.on("error", () => controller.error(new Error("MCP_LOCAL_CA_RESPONSE_FAILED")));
        },
        cancel() {
          response.destroy();
        },
      });
      resolve(new Response(stream, { status: response.statusCode ?? 0, statusText: response.statusMessage ?? "", headers: responseHeaders }));
    });
    request.on("error", () => reject(new Error("MCP_LOCAL_CA_REQUEST_FAILED")));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

const execFile = promisify(nodeExecFile);

/**
 * Host/SNI must be independently controllable for the audience probe. Bun's
 * https.request can coalesce the forged Host with the TLS request in a way
 * that does not exercise Caddy's real routing boundary, so this one probe
 * uses an allowlisted curl binary. The URL remains the TLS SNI while --resolve
 * pins the connection to loopback and the Host header is deliberately foreign.
 * No bearer is needed: Caddy rejects this request before API authentication.
 */
async function requestMcpAudienceOverCurl(options: McpLocalAudienceRequestOptions): Promise<Response> {
  const command = buildMcpLocalAudienceCurlCommand(options);
  try {
    const result = await execFile(command.executable, command.args, {
      timeout: command.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: MAX_CURL_OUTPUT_BYTES,
      encoding: "utf8",
      windowsHide: true,
    });
    const output = result.stdout;
    const separator = output.lastIndexOf("\n");
    if (separator < 0) throw new Error("MCP_LOCAL_AUDIENCE_RESPONSE_INVALID");
    const statusText = output.slice(separator + 1).trim();
    if (!/^\d{3}$/.test(statusText)) throw new Error("MCP_LOCAL_AUDIENCE_RESPONSE_INVALID");
    const responseBody = output.slice(0, separator);
    if (Buffer.byteLength(responseBody, "utf8") > MAX_CURL_OUTPUT_BYTES) throw new Error("MCP_LOCAL_EDGE_RESPONSE_TOO_LARGE");
    return new Response(responseBody, { status: Number(statusText), headers: { "content-type": "application/json" } });
  } catch (error) {
    if (error instanceof Error && error.message === "MCP_LOCAL_EDGE_RESPONSE_TOO_LARGE") throw error;
    throw new Error("MCP_LOCAL_AUDIENCE_REQUEST_FAILED");
  }
}

export interface McpLocalAudienceCurlCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export function buildMcpLocalAudienceCurlCommand(options: McpLocalAudienceRequestOptions): McpLocalAudienceCurlCommand {
  const hostname = options.endpoint.hostname;
  if (options.endpoint.protocol !== "https:" || options.servername !== hostname || options.host !== FOREIGN_HOST) {
    throw new Error("MCP_LOCAL_AUDIENCE_ENDPOINT_INVALID");
  }
  if (hostname !== "localhost" && !hostname.endsWith(".localhost") && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new Error("MCP_LOCAL_AUDIENCE_ENDPOINT_INVALID");
  }
  const port = options.endpoint.port || "443";
  const address = hostname === "::1" ? "[::1]" : "127.0.0.1";
  const resolution = `${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}:${address}`;
  const timeoutMs = Math.max(1, Math.min(Math.floor(options.timeoutMs), MAX_TIMEOUT_MS));
  const timeoutSeconds = Math.max(0.001, timeoutMs / 1000).toFixed(3);
  const body = JSON.stringify({ jsonrpc: "2.0", id: "audience", method: "tools/list", params: {} });
  const args = [
    "--silent",
    "--show-error",
    "--proto",
    "=https",
    "--max-time",
    timeoutSeconds,
    "--connect-timeout",
    timeoutSeconds,
    "--cacert",
    options.caPath,
    "--resolve",
    resolution,
    "--header",
    `Host: ${FOREIGN_HOST}`,
    "--header",
    "Accept: application/json, text/event-stream",
    "--header",
    "Content-Type: application/json",
    "--header",
    `X-Correlation-ID: ${options.correlationId}`,
    "--data-raw",
    body,
    "--write-out",
    "\n%{http_code}",
    options.endpoint.href,
  ];
  return { executable: CURL_EXECUTABLE, args, timeoutMs };
}

/** Construct the mandatory, bounded request-level security probes. */
export async function createMcpLocalEdgeProbe(
  options: McpLocalEdgeProbeOptions,
): Promise<McpLocalEdgeProbe> {
  const ca = await readTrustedCa(options.connection.caPath);
  const fetchImpl = options.fetchImpl ?? createCaBoundFetch(ca, options.httpsRequest);
  const endpoint = new URL(options.connection.endpoint);
  if (endpoint.href !== options.connection.resource || endpoint.protocol !== "https:" || endpoint.pathname !== "/mcp"
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.hostname.length === 0) {
    throw new Error("MCP_LOCAL_RESOURCE_INVALID");
  }
  return async (input) => {
    const correlationId = `mcp-local-probe-${input.kind}`;
    const request = async (body: string, headers: Record<string, string> = {}): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(options.connection.timeoutMs, MAX_TIMEOUT_MS));
      try {
        return await fetchImpl(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            authorization: `Bearer ${options.identity.token}`,
            origin: endpoint.origin,
            "mcp-protocol-version": options.connection.era === "legacy" ? LEGACY_PROTOCOL_VERSION : MODERN_PROTOCOL_VERSION,
            "x-correlation-id": correlationId,
            ...headers,
          },
          body,
        });
      } catch {
        throw new Error("MCP_LOCAL_EDGE_PROBE_FAILED");
      } finally {
        clearTimeout(timer);
      }
    };
    if (input.kind === "malformed") {
      const response = await request("{");
      const body = await safeResponseJson(response);
      const validProtocolError = isJsonRpcInvalidRequest(body);
      return edgeResult(response.status === 400 && validProtocolError && response.headers.get("x-correlation-id") === correlationId, validProtocolError ? "MCP_JSONRPC_INVALID_REQUEST" : "MCP_EDGE_MALFORMED_INVALID");
    }
    if (input.kind === "body_limit") {
      const response = await request(`{"jsonrpc":"2.0","id":"body","method":"tools/list","params":{},"padding":"${"x".repeat(1_048_577)}"}`);
      const body = await safeResponseJson(response);
      return edgeResult(response.status === 413, bodyCode(body) ?? "MCP_EDGE_BODY_LIMIT_INVALID");
    }
    if (input.kind === "origin") {
      const response = await request(JSON.stringify({ jsonrpc: "2.0", id: "origin", method: "tools/list", params: {} }), { origin: "https://foreign.invalid" });
      const body = await safeResponseJson(response);
      return edgeResult(response.status === 403, bodyCode(body) ?? "MCP_EDGE_ORIGIN_INVALID");
    }
    if (input.kind === "audience") {
      // The transport derives audience from the request URL and the validated
      // token. A Host mismatch must be rejected without trusting proxy headers.
      let response: Response;
      try {
        const audienceRequest = options.audienceRequest ?? requestMcpAudienceOverCurl;
        response = await audienceRequest({
          endpoint,
          servername: endpoint.hostname,
          host: FOREIGN_HOST,
          caPath: options.connection.caPath,
          correlationId,
          timeoutMs: options.connection.timeoutMs,
        });
      } catch {
        throw new Error("MCP_LOCAL_EDGE_PROBE_FAILED");
      }
      const body = await safeResponseJson(response);
      return edgeResult(response.status === 403 && bodyCode(body) === "MCP_HOST_NOT_ALLOWED", bodyCode(body) ?? "MCP_EDGE_AUDIENCE_INVALID");
    }
    if (input.kind === "correlation") {
      const requestMeta = options.connection.era === "legacy" ? {} : {
        [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
        [CLIENT_INFO_META_KEY]: { name: "noosphere-local-verifier", version: "1.0.0" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
        correlationId,
      };
      const response = await request(JSON.stringify({
        jsonrpc: "2.0",
        id: "correlation",
        method: "tools/call",
        params: { name: "noosphere_ping", arguments: {}, ...(options.connection.era === "legacy" ? {} : { _meta: requestMeta }) },
      }), options.connection.era === "legacy" ? {} : {
        "mcp-method": "tools/call",
        "mcp-name": "noosphere_ping",
      });
      const body = await safeResponseJson(response);
      const headerCorrelation = response.headers.get("x-correlation-id");
      const bodyCorrelations = responseCorrelationIds(body);
      const correlationValid = response.status === 200
        && isBoundedCorrelation(headerCorrelation)
        && headerCorrelation === correlationId
        && bodyCorrelations.length > 0
        && bodyCorrelations.every((value) => value === correlationId);
      return edgeResult(correlationValid, correlationValid ? "MCP_CORRELATION_OK" : "MCP_EDGE_CORRELATION_INVALID");
    }
    for (let attempt = 0; attempt < RATE_LIMIT_PROBE_ATTEMPTS; attempt += 1) {
      const response = await request(JSON.stringify({ jsonrpc: "2.0", id: attempt, method: "tools/list", params: {} }), { "x-correlation-id": `${correlationId}-${attempt}` });
      if (response.status !== 429) {
        await consumeBoundedResponse(response);
        continue;
      }
      const retryAfter = response.headers.get("retry-after");
      const body = await safeResponseJson(response);
      const retryValid = retryAfter !== null && /^\d{1,5}$/.test(retryAfter) && Number(retryAfter) >= 1;
      return edgeResult(retryValid && bodyCode(body) === "RATE_LIMITED", bodyCode(body) ?? "MCP_EDGE_RATE_LIMIT_INVALID");
    }
    throw new Error("MCP_LOCAL_RATE_LIMIT_PROBE_UNOBSERVED");
  };
}

function edgeResult(ok: boolean, code: string): McpLocalVerificationProbeResult {
  return { ok, code: safeCode(code) ?? "MCP_EDGE_PROBE_INVALID" };
}

async function consumeBoundedResponse(response: Response): Promise<void> {
  await readBoundedText(response, 64 * 1024);
}

export async function safeResponseJson(response: Response): Promise<unknown> {
  const text = await readBoundedText(response, 64 * 1024);
  if (!text) return null;
  const trimmed = text.trim();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const candidate = contentType.includes("text/event-stream") || looksLikeSse(trimmed)
    ? parseSseMessage(trimmed)
    : trimmed;
  if (candidate === null) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function looksLikeSse(text: string): boolean {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0]?.replace(/^\uFEFF/, "") ?? "";
  return /^(?::|event:|data:|id:|retry:)/.test(firstLine);
}

/** Parse exactly one bounded SSE message; comments are allowed, events are not. */
function parseSseMessage(text: string): string | null {
  const lines = text.split(/\r\n|\n|\r/);
  const data: string[] = [];
  let event: string | undefined;
  let dispatched = false;
  let invalid = false;
  let payload: string | undefined;
  const dispatch = (): void => {
    if (data.length === 0) {
      if (event !== undefined && dispatched) invalid = true;
      event = undefined;
      return;
    }
    if (event !== undefined && event !== "message") {
      invalid = true;
      return;
    }
    if (dispatched) {
      invalid = true;
      return;
    }
    dispatched = true;
    payload = data.join("\n");
    data.length = 0;
    event = undefined;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = index === 0 ? lines[index]!.replace(/^\uFEFF/, "") : lines[index]!;
    if (line === "") {
      dispatch();
      if (invalid) return null;
      continue;
    }
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const field = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      if (value.length > MAX_TEXT_BYTES) return null;
      data.push(value);
      continue;
    }
    if (field === "event") {
      if (event !== undefined || value.length > 128) return null;
      event = value;
      continue;
    }
    if (field === "id") {
      if (value.length > 256) return null;
      continue;
    }
    if (field === "retry") {
      if (!/^\d{1,5}$/.test(value)) return null;
      continue;
    }
    return null;
  }
  dispatch();
  if (invalid || !dispatched || payload === undefined || payload.length === 0) return null;
  return payload;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error("MCP_LOCAL_EDGE_RESPONSE_TOO_LARGE");
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

function bodyCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const error = root.error;
  if (error && typeof error === "object" && !Array.isArray(error) && typeof (error as Record<string, unknown>).code === "string") return safeCode((error as Record<string, unknown>).code);
  const result = root.result;
  if (result && typeof result === "object" && !Array.isArray(result) && typeof (result as Record<string, unknown>).code === "string") return safeCode((result as Record<string, unknown>).code);
  return typeof root.code === "string" ? safeCode(root.code) : null;
}

/** Extract correlation fields only from bounded MCP response envelopes. */
function responseCorrelationIds(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const root = value as Record<string, unknown>;
  const ids: string[] = [];
  const add = (candidate: unknown): void => {
    if (isBoundedCorrelation(candidate)) ids.push(candidate);
  };
  add(root.correlationId);
  const result = root.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return [...new Set(ids)];
  const resultRecord = result as Record<string, unknown>;
  add(resultRecord.correlationId);
  const structuredContent = resultRecord.structuredContent;
  if (structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)) {
    add((structuredContent as Record<string, unknown>).correlationId);
  }
  const content = resultRecord.content;
  if (!Array.isArray(content)) return [...new Set(ids)];
  for (const item of content.slice(0, MAX_ITEMS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text !== "string" || !boundedBytes(text, MAX_TEXT_BYTES)) continue;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) add((parsed as Record<string, unknown>).correlationId);
    } catch {
      // Non-JSON content is not evidence of a correlation identity.
    }
  }
  return [...new Set(ids)];
}

function isJsonRpcInvalidRequest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length > MAX_ITEMS || root.jsonrpc !== "2.0") return false;
  const error = root.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const details = error as Record<string, unknown>;
  return Object.keys(details).length <= MAX_ITEMS
    && details.code === -32600
    && typeof details.message === "string"
    && boundedBytes(details.message, MAX_TEXT_BYTES);
}

/** Official SDK adapter used by the CLI; the token remains in process memory. */
export const createMcpLocalSdkFactory: McpLocalSdkFactory = async (identity, connection, injectedFetch) => {
  const ca = await readTrustedCa(connection.caPath);
  const fetchImpl = injectedFetch ?? createCaBoundFetch(ca);
  const client = new Client(
    { name: `noosphere-local-${connection.era ?? "modern"}`, version: "1.0.0" },
    { versionNegotiation: { mode: connection.era === "legacy" ? "legacy" : "auto" }, listMaxPages: 8 },
  );
  const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), {
    authProvider: { token: async () => identity.token },
    onInsufficientScope: "throw",
    fetch: fetchImpl,
  });
  const rawPing = () => rawMcpLocalPing(connection, identity.token, fetchImpl);
  return {
    initialize: async () => {
      await client.connect(transport);
    },
    listTools: async () => {
      const result = await client.listTools();
      return { tools: result.tools.slice(0, MAX_ITEMS).map((tool) => ({ name: tool.name })) };
    },
    listResources: async () => {
      const result = await client.listResources();
      return { resources: result.resources.slice(0, MAX_ITEMS).map((resource) => ({
        uri: resource.uri,
        ...(typeof resource.name === "string" ? { name: resource.name } : {}),
      })) };
    },
    readResource: async (uri) => {
      const result = await client.readResource({ uri });
      return {
        contents: result.contents.slice(0, MAX_ITEMS).flatMap((content) => {
          if (typeof content.uri !== "string") return [];
          if ("text" in content && typeof content.text === "string") {
            return [{ uri: content.uri, text: content.text, ...(typeof content.mimeType === "string" ? { mimeType: content.mimeType } : {}) }];
          }
          return [{ uri: content.uri, ...(typeof content.mimeType === "string" ? { mimeType: content.mimeType } : {}) }];
        }),
      };
    },
    ...(typeof client.ping === "function" ? {
      ping: async () => {
        try {
          return { ...(await client.ping()) };
        } catch (error) {
          if (!isUnsupportedPingError(error)) throw error;
          return rawPing();
        }
      },
    } : {}),
    rawPing,
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return {
        isError: Boolean(result.isError),
        content: result.content.slice(0, MAX_ITEMS).flatMap((item): McpLocalContentItem[] => {
          if (item.type === "text" && typeof item.text === "string") return [{ type: "text" as const, text: item.text }];
          if (item.type === "image" && typeof item.data === "string") return [{ type: "image" as const, data: item.data, ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}) }];
          if (item.type === "resource" && item.resource && typeof item.resource.uri === "string") return [{ type: "resource" as const }];
          return [];
        }),
        ...(boundedStructuredContent(result.structuredContent) ? { structuredContent: boundedStructuredContent(result.structuredContent)! } : {}),
      };
    },
    close: async () => {
      await client.close();
    },
  };
};

function boundedStructuredContent(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (!boundedBytes(key, 160)) continue;
    if (typeof entry === "string" && boundedBytes(entry, MAX_TEXT_BYTES)) result[key] = entry;
    else if (typeof entry === "number" && Number.isSafeInteger(entry)) result[key] = entry;
    else if (typeof entry === "boolean" || entry === null) result[key] = entry;
  }
  return result;
}

/**
 * Construct the edge harness from the private #83 files. The token is read
 * only inside this module and is captured by the probe closure; neither the
 * identity nor its bearer is returned to callers or reports.
 */
export interface McpLocalConfiguredEdgeProbeOptions {
  /** Internal bounded seam; the CLI leaves this unset for the CA-bound fetch. */
  readonly fetchImpl?: FetchLike;
  /** Internal bounded seam for tests; the CLI leaves this unset for curl. */
  readonly audienceRequest?: McpLocalAudienceRequest;
}

export async function createMcpLocalConfiguredEdgeProbe(
  configPath: string,
  timeoutMs = 30_000,
  seam: McpLocalConfiguredEdgeProbeOptions = {},
): Promise<McpLocalEdgeProbe> {
  const config = await loadClientConfig(configPath);
  const identities = await loadSdkIdentities(config);
  const identity = requireIdentity(identities, "reviewer");
  return createMcpLocalEdgeProbe({
    identity,
    connection: {
      endpoint: config.resource,
      resource: config.resource,
      caPath: config.caPath,
      timeoutMs,
      era: "modern",
    },
    ...(seam.fetchImpl === undefined ? {} : { fetchImpl: seam.fetchImpl }),
    ...(seam.audienceRequest === undefined ? {} : { audienceRequest: seam.audienceRequest }),
  });
}

/** Load only the validated, non-secret portion of the #83 client config. */
export async function loadMcpLocalClientConfig(configPath: string): Promise<{
  readonly resource: string;
  readonly caPath: string;
  readonly tokenFilePath: string;
  readonly identities: readonly McpLocalIdentityLabel[];
}> {
  const config = await loadClientConfig(configPath);
  return {
    resource: config.resource,
    caPath: config.caPath,
    tokenFilePath: config.tokenFilePath,
    identities: config.identities,
  };
}

async function protocolJourney(
  client: McpLocalSdkClient,
  budget: CallBudget,
  checks: McpLocalVerificationCheck[],
  era: "modern" | "legacy",
): Promise<{ readonly ok: boolean }> {
  await budget.call(() => client.initialize());
  const tools = await budget.call(() => client.listTools());
  const validTools = validateTools(tools);
  checks.push(check(`${era}.tools`, validTools && REQUIRED_TOOLS.every((name) => tools.tools.some((tool) => tool.name === name)), "MCP_TOOLS_OK", "MCP_TOOLS_INCOMPLETE"));
  const resources = await budget.call(() => client.listResources());
  const validResources = validateResources(resources);
  checks.push(check(`${era}.resources`, validResources && resources.resources.some((resource) => resource.uri === EXPECTED_RESOURCES[0]), "MCP_RESOURCES_OK", "MCP_RESOURCES_INCOMPLETE"));
  const runtime = await budget.call(() => client.readResource(EXPECTED_RESOURCES[0]));
  const validRuntime = validateResourceContents(runtime);
  checks.push(check(`${era}.resource_read`, validRuntime, "MCP_RESOURCE_READ_OK", "MCP_RESOURCE_READ_INVALID"));
  // MCP 2026-07-28 does not define the standalone ping request.  Calling
  // Client.ping/raw ping there produces a protocol-level Method not found;
  // the tool-level noosphere_ping below is the explicit modern proof. Legacy
  // remains compatible with the older ping request and its bounded SSE path.
  let validPing = true;
  if (era === "legacy") {
    const ping = await budget.call(() => pingWithFallback(client));
    validPing = ping !== null && typeof ping === "object" && !Array.isArray(ping);
    checks.push(check(`${era}.ping`, validPing, "MCP_PING_OK", "MCP_PING_INVALID"));
  } else {
    checks.push(check("modern.ping", true, "MCP_PROTOCOL_PING_NOT_APPLICABLE", "MCP_PROTOCOL_PING_NOT_APPLICABLE"));
  }
  let toolPing = era !== "modern";
  if (validTools && tools.tools.some((tool) => tool.name === "noosphere_ping")) {
    const result = await budget.call(() => client.callTool("noosphere_ping", { traceId: `mcp-local-${era}` }));
    toolPing = validateToolResult(result) && !result.isError;
    checks.push(check(`${era}.noosphere_ping`, toolPing, "MCP_TOOL_PING_OK", "MCP_TOOL_PING_FAILED"));
  } else if (era === "modern") {
    checks.push(check("modern.noosphere_ping", false, "MCP_TOOL_PING_OK", "MCP_TOOL_PING_REQUIRED"));
  }
  return { ok: validTools && validResources && validRuntime && validPing && toolPing };
}

async function pingWithFallback(client: McpLocalSdkClient): Promise<Readonly<Record<string, unknown>>> {
  if (typeof client.ping === "function") {
    try {
      return await client.ping();
    } catch (error) {
      // SDK versions that negotiated 2026-07-28 may omit/reject the optional
      // ping method. Only this explicitly classified unsupported case may
      // use the authenticated raw HTTPS fallback; real protocol failures
      // remain visible to the bounded verifier.
      if (!isUnsupportedPingError(error)) throw error;
    }
  }
  if (typeof client.rawPing === "function") return client.rawPing();
  throw new Error("MCP_LOCAL_PING_UNSUPPORTED");
}

function isUnsupportedPingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:ping.*(?:not supported|unsupported|method not found)|(?:not supported|unsupported|method not found).*ping)/i.test(error.message);
}

async function rawMcpLocalPing(
  connection: McpLocalConnection,
  token: string,
  fetchImpl: FetchLike,
): Promise<Readonly<Record<string, unknown>>> {
  const endpoint = new URL(connection.endpoint);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: endpoint.origin,
      "mcp-protocol-version": connection.era === "legacy" ? LEGACY_PROTOCOL_VERSION : MODERN_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "ping" }),
  });
  const body = await safeResponseJson(response);
  if (response.status !== 200) throw new Error("MCP_LOCAL_PING_HTTP");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("MCP_LOCAL_PING_INVALID");
  const root = body as Record<string, unknown>;
  if (root.error !== undefined) throw new Error("MCP_LOCAL_PING_PROTOCOL_ERROR");
  if (!isBoundedPingResult(root.result)) throw new Error("MCP_LOCAL_PING_INVALID");
  return root.result;
}

function isBoundedPingResult(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length <= MAX_ITEMS;
}

async function verifyToolMatrix(
  operator: McpLocalSdkClient,
  reviewer: McpLocalSdkClient,
  viewer: McpLocalSdkClient,
  revokedIdentity: McpLocalSdkIdentity,
  config: ParsedClientConfig,
  options: VerifyMcpLocalOptions,
  budget: CallBudget,
  opened: OpenClient[],
  checks: McpLocalVerificationCheck[],
): Promise<McpLocalEffectEvidence> {
  const ownAggregateId = options.fixtureIds.aggregate.foreign;
  const conversationRequestKey = crypto.randomUUID();
  const prepareArgs = {
    conversationId: ownAggregateId,
    body: "bounded local verifier body",
    requestKey: conversationRequestKey,
    expectedVersion: 1,
  } as const;
  const operatorPrepare = await budget.call(() => operator.callTool("conversation_prepare_reply", prepareArgs));
  checks.push(check("operator.prepare", validateToolResult(operatorPrepare) && !operatorPrepare.isError, "MCP_OPERATOR_PREPARE_OK", "MCP_OPERATOR_PREPARE_FAILED"));
  const operatorReplay = await budget.call(() => operator.callTool("conversation_prepare_reply", prepareArgs));
  const parsedOperatorPrepare = parsePrepareResult(operatorPrepare, "conversation_reply");
  const parsedOperatorReplay = parsePrepareResult(operatorReplay, "conversation_reply");
  const operatorReplayStable = parsedOperatorPrepare !== null
    && parsedOperatorReplay !== null
    && samePrepareIdentity(parsedOperatorPrepare, parsedOperatorReplay);
  checks.push(check("operator.conversation_prepare_replay", operatorReplayStable, "MCP_OPERATOR_PREPARE_REPLAY_STABLE", "MCP_OPERATOR_PREPARE_REPLAY_INVALID"));
  if (!parsedOperatorPrepare || !operatorReplayStable) throw new Error("MCP_LOCAL_APPROVAL_ITEM_MISSING");

  const reviewerPrepare = await budget.call(() => reviewer.callTool("conversation_prepare_reply", prepareArgs));
  const reviewerPrepareForbidden = validateToolResult(reviewerPrepare)
    && reviewerPrepare.isError
    && toolErrorCode(reviewerPrepare) === "MCP_GOVERNED_EFFECT_FORBIDDEN";
  checks.push(check("reviewer.prepare_forbidden", reviewerPrepareForbidden, "MCP_REVIEWER_PREPARE_FORBIDDEN", "MCP_REVIEWER_PREPARE_ALLOWED"));
  if (!reviewerPrepareForbidden) throw new Error("MCP_LOCAL_REVIEWER_PREPARE_ALLOWED");

  const decision = await budget.call(() => reviewer.callTool("approval_decide", { approvalItemId: parsedOperatorPrepare.approvalItemId, decision: "approve" }));
  checks.push(check("reviewer.approval", validateToolResult(decision) && !decision.isError, "MCP_APPROVAL_OK", "MCP_APPROVAL_FAILED"));
  const viewerPrepare = await budget.call(() => viewer.callTool("conversation_prepare_reply", { ...prepareArgs, conversationId: options.fixtureIds.aggregate.viewer }));
  checks.push(check("viewer.write_guard", validateToolResult(viewerPrepare) && viewerPrepare.isError, "MCP_VIEWER_WRITE_DENIED", "MCP_VIEWER_WRITE_UNCHECKED"));
  const viewerDecision = await budget.call(() => viewer.callTool("approval_decide", { approvalItemId: options.fixtureIds.proposal.viewer, decision: "approve" }));
  checks.push(check("viewer.approval_guard", validateToolResult(viewerDecision) && viewerDecision.isError, "MCP_VIEWER_APPROVAL_DENIED", "MCP_VIEWER_APPROVAL_UNCHECKED"));
  const foreignLookup = await budget.call(() => viewer.callTool("approval_get", { proposalId: options.fixtureIds.proposal.foreign }));
  checks.push(check("foreign.lookup", validateToolResult(foreignLookup) && foreignLookup.isError, "MCP_FOREIGN_HIDDEN", "MCP_FOREIGN_VISIBLE"));
  const revokedClient = await openClient(options, revokedIdentity, config, "legacy", budget, opened);
  let revokedAccessDenied = false;
  try {
    await budget.call(() => revokedClient.client.initialize());
  } catch {
    revokedAccessDenied = true;
  }
  checks.push(check("revoked.access", revokedAccessDenied, "MCP_REVOKED_DENIED", "MCP_REVOKED_ACCEPTED"));

  const effect = await verifyContentJourney(operator, reviewer, config, options, budget, checks);
  await verifyCampaignUnavailable(operator, reviewer, options, budget, checks);
  return effect;
}

interface ParsedPrepareResult {
  readonly proposalId: string;
  readonly approvalItemId: string;
  readonly kind: "conversation_reply" | "content_publication" | "meeting_proposal" | "campaign_activation";
  readonly status: string;
  readonly resultFingerprint: string;
}

async function verifyContentJourney(
  operator: McpLocalSdkClient,
  reviewer: McpLocalSdkClient,
  config: ParsedClientConfig,
  options: VerifyMcpLocalOptions,
  budget: CallBudget,
  checks: McpLocalVerificationCheck[],
): Promise<McpLocalEffectEvidence> {
  const reviewerWorkspaceId = config.identities.find((identity) => identity.name === "reviewer")?.workspaceId;
  if (!reviewerWorkspaceId) throw new Error("MCP_LOCAL_REVIEWER_WORKSPACE_MISSING");
  const requestKey = crypto.randomUUID();
  const args = {
    assetId: options.fixtureIds.content.foreign.assetId,
    requestKey,
  } as const;
  const first = await budget.call(() => operator.callTool("content_prepare_publication", args));
  const replay = await budget.call(() => operator.callTool("content_prepare_publication", args));
  const parsedFirst = parsePrepareResult(first, "content_publication");
  const parsedReplay = parsePrepareResult(replay, "content_publication");
  const replayStable = parsedFirst !== null && parsedReplay !== null && samePrepareIdentity(parsedFirst, parsedReplay);
  checks.push(check("operator.content_prepare_replay", replayStable, "MCP_CONTENT_REPLAY_STABLE", "MCP_CONTENT_REPLAY_INVALID"));
  if (!parsedFirst || !replayStable) throw new Error("MCP_LOCAL_CONTENT_RETURN_INVALID");

  const before = await budget.call(() => options.readDurableStateForProposal(parsedFirst.proposalId, reviewerWorkspaceId));
  validateDurableState(before);
  const decision = await budget.call(() => reviewer.callTool("approval_decide", { approvalItemId: parsedFirst.approvalItemId, decision: "approve" }));
  checks.push(check("content.approval", validateToolResult(decision) && !decision.isError, "MCP_CONTENT_APPROVAL_OK", "MCP_CONTENT_APPROVAL_FAILED"));
  const after = await readGeneratedStateUntilSettled(options, parsedFirst.proposalId, reviewerWorkspaceId, before, budget);
  validateDurableState(after);
  const stableReplay = await budget.call(() => options.readDurableStateForProposal(parsedFirst.proposalId, reviewerWorkspaceId));
  validateDurableState(stableReplay);
  const reconciliationStable = sameDurableIdentity(after, stableReplay);
  checks.push(check("content.durable_replay", reconciliationStable, "MCP_CONTENT_DURABLE_REPLAY_STABLE", "MCP_CONTENT_DURABLE_REPLAY_CHANGED"));
  const providerBoundaryAttempts = after.providerBoundaryAttempts - before.providerBoundaryAttempts;
  const exactOutcome = after.terminalResults - before.terminalResults === 1;
  const exactMarker = providerBoundaryAttempts === 1;
  const localFakeBoundaryVerified = options.localFakeEnabled === true && after.localFakeBoundaryVerified === true;
  const exactReconciliation = (after.reconciliations ?? 0) - (before.reconciliations ?? 0) === 0;
  checks.push(check("content.provider_boundary_attempt", exactMarker, "MCP_PROVIDER_BOUNDARY_ATTEMPT_SINGLE", "MCP_PROVIDER_BOUNDARY_ATTEMPT_INVALID"));
  checks.push(check("content.outcome", exactOutcome, "MCP_CONTENT_OUTCOME_OBSERVED", "MCP_CONTENT_OUTCOME_MISSING"));
  checks.push(check("content.local_fake_boundary", localFakeBoundaryVerified, "MCP_LOCAL_FAKE_BOUNDARY_VERIFIED", "MCP_LOCAL_FAKE_BOUNDARY_UNVERIFIED"));
  checks.push(check("content.reconciliation", exactReconciliation, "MCP_CONTENT_RECONCILIATION_NONE", "MCP_CONTENT_RECONCILIATION_UNEXPECTED"));
  const status = after.proposalStatuses?.[0] ?? after.refs.terminalStatuses[0];
  const delivered = status === "delivered";
  checks.push(check("content.delivered", delivered, "MCP_CONTENT_DELIVERED", "MCP_CONTENT_NOT_DELIVERED"));
  if (!exactMarker || !exactOutcome || !localFakeBoundaryVerified || !exactReconciliation || !delivered) throw new Error("MCP_LOCAL_CONTENT_DURABLE_EVIDENCE_MISSING");
  return {
    kind: "content_publication",
    proposalId: parsedFirst.proposalId,
    approvalItemId: parsedFirst.approvalItemId,
    providerBoundaryAttempts,
    beforeRefs: before.refs,
    afterRefs: after.refs,
    outcomeTraceIds: [...after.refs.resultTraceIds],
    durableRefs: after.refs,
    status,
    replayStable,
    reconciliationStable,
    beforeState: before,
    afterState: after,
    localFakeBoundaryVerified,
  };
}

async function verifyCampaignUnavailable(
  operator: McpLocalSdkClient,
  reviewer: McpLocalSdkClient,
  options: VerifyMcpLocalOptions,
  budget: CallBudget,
  checks: McpLocalVerificationCheck[],
): Promise<void> {
  const result = await budget.call(() => operator.callTool("campaign_prepare_activation", {
    campaignId: options.fixtureIds.content.foreign.campaignId,
    requestKey: crypto.randomUUID(),
  }));
  let unavailable = result.isError && toolErrorCode(result) === "MCP_EFFECT_ADAPTER_UNAVAILABLE";
  if (!result.isError) {
    const prepared = parsePrepareResult(result, "campaign_activation");
    if (prepared) {
      const decision = await budget.call(() => reviewer.callTool("approval_decide", { approvalItemId: prepared.approvalItemId, decision: "approve" }));
      unavailable = decision.isError && toolErrorCode(decision) === "MCP_EFFECT_ADAPTER_UNAVAILABLE";
    }
  }
  checks.push(check("campaign.adapter", unavailable, "MCP_CAMPAIGN_ADAPTER_UNAVAILABLE", "MCP_CAMPAIGN_ADAPTER_UNEXPECTED"));
  if (!unavailable) throw new Error("MCP_LOCAL_CAMPAIGN_UNAVAILABLE_INVALID");
}

async function readGeneratedStateUntilSettled(
  options: VerifyMcpLocalOptions,
  proposalId: string,
  workspaceId: string,
  before: McpLocalDurableState,
  budget: CallBudget,
): Promise<McpLocalDurableState> {
  let latest = await budget.call(() => options.readDurableStateForProposal(proposalId, workspaceId));
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (hasGeneratedEffectEvidence(before, latest)) return latest;
    const remaining = budget.remaining();
    if (remaining <= 2) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining - 1)));
    latest = await budget.call(() => options.readDurableStateForProposal(proposalId, workspaceId));
  }
  return latest;
}

function hasGeneratedEffectEvidence(before: McpLocalDurableState, after: McpLocalDurableState): boolean {
  return after.intentions - before.intentions === 1
    && after.jobs - before.jobs === 1
    && after.outbox - before.outbox === 1
    && after.providerBoundaryAttempts - before.providerBoundaryAttempts === 1
    && after.terminalResults - before.terminalResults === 1;
}

function parsePrepareResult(value: unknown, expectedKind: ParsedPrepareResult["kind"]): ParsedPrepareResult | null {
  if (!validateToolResult(value) || value.isError) return null;
  const candidate = value.structuredContent ?? parseStructuredText(value.content);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (!UUID.test(String(record.proposalId ?? "")) || !UUID.test(String(record.approvalItemId ?? ""))) return null;
  if (record.kind !== expectedKind || typeof record.status !== "string" || !DURABLE_STATUSES.has(record.status)) return null;
  const resultFingerprint = prepareResultFingerprint(value);
  if (resultFingerprint === null) return null;
  return { proposalId: record.proposalId as string, approvalItemId: record.approvalItemId as string, kind: expectedKind, status: record.status, resultFingerprint };
}

function samePrepareIdentity(left: ParsedPrepareResult, right: ParsedPrepareResult): boolean {
  return left.proposalId === right.proposalId
    && left.approvalItemId === right.approvalItemId
    && left.kind === right.kind
    && left.status === right.status
    && left.resultFingerprint === right.resultFingerprint;
}

function prepareResultFingerprint(value: McpLocalToolResult): string | null {
  try {
    const fingerprint = JSON.stringify({
      isError: value.isError,
      content: value.content,
      structuredContent: value.structuredContent ?? parseStructuredText(value.content),
    });
    return typeof fingerprint === "string" && boundedBytes(fingerprint, 64 * 1024) ? fingerprint : null;
  } catch {
    return null;
  }
}

function parseStructuredText(content: readonly McpLocalContentItem[]): unknown {
  const text = content.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (!text || !boundedBytes(text, MAX_TEXT_BYTES)) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

function toolErrorCode(value: unknown): string | null {
  if (!validateToolResult(value)) return null;
  const candidate = value.structuredContent ?? parseStructuredText(value.content);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const error = (candidate as Record<string, unknown>).error;
  return safeCode(error);
}

function toolStatus(value: unknown): string | null {
  if (!validateToolResult(value)) return null;
  const candidate = value.structuredContent ?? parseStructuredText(value.content);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const status = (candidate as Record<string, unknown>).status;
  return typeof status === "string" && DURABLE_STATUSES.has(status) ? status : null;
}

function publicationAccountId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const accountId = (value as Record<string, unknown>).providerAccountId;
  return typeof accountId === "string" && boundedBytes(accountId, MAX_TEXT_BYTES) ? accountId : null;
}

/** Read only the bounded fake reference from the redacted result trace. */
function resultCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" && safeCode(code) ? code : null;
}

function sameDurableIdentity(left: McpLocalDurableState, right: McpLocalDurableState): boolean {
  return left.providerBoundaryAttempts === right.providerBoundaryAttempts
    && left.intentions === right.intentions
    && left.jobs === right.jobs
    && left.outbox === right.outbox
    && left.attempts === right.attempts
    && left.terminalResults === right.terminalResults
    && left.reconciliations === right.reconciliations
    && left.localFakeBoundaryVerified === right.localFakeBoundaryVerified
    && JSON.stringify(left.refs) === JSON.stringify(right.refs)
    && JSON.stringify(left.proposalStatuses ?? []) === JSON.stringify(right.proposalStatuses ?? []);
}

async function verifyEdgeProbes(options: VerifyMcpLocalOptions, budget: CallBudget, checks: McpLocalVerificationCheck[]): Promise<void> {
  if (typeof options.probe !== "function") throw new Error("MCP_LOCAL_EDGE_PROBE_REQUIRED");
  const probes: readonly McpLocalVerificationProbe[] = [
    { kind: "malformed" },
    { kind: "body_limit" },
    { kind: "rate_limit" },
    { kind: "origin" },
    { kind: "audience" },
    { kind: "correlation" },
  ];
  for (const probe of probes) {
    const result = await budget.call(() => options.probe!(probe));
    const code = safeCode(result.code) ?? "MCP_EDGE_PROBE_INVALID";
    checks.push(check(`edge.${probe.kind}`, result.ok, code, code));
  }
}

async function openClient(
  options: VerifyMcpLocalOptions,
  identity: McpLocalSdkIdentity,
  config: ParsedClientConfig,
  era: "modern" | "legacy",
  budget: CallBudget,
  opened: OpenClient[],
): Promise<OpenClient> {
  const connection: McpLocalConnection = {
    endpoint: config.resource,
    resource: config.resource,
    caPath: config.caPath,
    timeoutMs: Math.min(options.timeoutMs, MAX_TIMEOUT_MS),
    era,
  };
  const client = await budget.call(() => options.sdkFactory(identity, connection));
  if (!client || typeof client !== "object" || typeof client.initialize !== "function" || typeof client.close !== "function") throw new Error("MCP_LOCAL_SDK_CLIENT_INVALID");
  const openedClient = { client, identity };
  opened.push(openedClient);
  return openedClient;
}

async function closeClients(opened: readonly OpenClient[]): Promise<void> {
  await Promise.all(opened.map(async ({ client }) => {
    try {
      await Promise.race([client.close(), new Promise<void>((resolve) => setTimeout(resolve, 250))]);
    } catch {
      // Cleanup is best effort; no raw client/provider error is exposed.
    }
  }));
}

function createCallBudget(timeoutMs: number, maxCalls: number): CallBudget {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  return {
    remaining: () => Math.max(0, deadline - Date.now()),
    call: async <T>(operation: () => Promise<T>): Promise<T> => {
      count += 1;
      if (count > maxCalls) throw new Error("MCP_LOCAL_CALL_BUDGET_EXCEEDED");
      const remaining = Math.max(1, deadline - Date.now());
      return Promise.race([
        operation(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MCP_LOCAL_VERIFICATION_TIMEOUT")), remaining)),
      ]);
    },
  };
}

async function loadClientConfig(configPath: string): Promise<ParsedClientConfig> {
  if (typeof configPath !== "string" || configPath.length === 0 || configPath.length > 4_096 || /[\u0000-\u001f\u007f]/.test(configPath)) throw new Error("MCP_LOCAL_CONFIG_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readPrivateText(configPath, "MCP_LOCAL_CONFIG_PERMISSIONS_INVALID", "MCP_LOCAL_CONFIG_UNREADABLE")) as unknown;
  } catch (error) {
    if (error instanceof Error && (error.message === "MCP_LOCAL_CONFIG_PERMISSIONS_INVALID" || error.message === "MCP_LOCAL_CONFIG_UNREADABLE")) throw error;
    throw new Error("MCP_LOCAL_CONFIG_UNREADABLE");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP_LOCAL_CONFIG_INVALID");
  const record = parsed as Record<string, unknown>;
  const resource = canonicalResource(record.resource);
  if (record.transport !== "streamable-http" || record.legacyTransport !== "http" || record.redacted !== true) throw new Error("MCP_LOCAL_CONFIG_INVALID");
  const caPath = boundedPath(record.caPath);
  const tokenFilePath = boundedPath(record.tokenFilePath);
  const identities = validateIdentityLabels(record.identities);
  return { resource, caPath, tokenFilePath, identities };
}

async function loadSdkIdentities(config: ParsedClientConfig): Promise<readonly (McpLocalSdkIdentity & { readonly revokedToken: string })[]> {
  const values = parsePrivateTokenFile(await readPrivateText(config.tokenFilePath, "MCP_LOCAL_TOKEN_FILE_PERMISSIONS_INVALID", "MCP_LOCAL_TOKEN_FILE_UNREADABLE"));
  return config.identities.map((identity) => ({
    ...identity,
    token: boundedToken(values[tokenKey(identity.name)]),
    revokedToken: boundedToken(values.MCP_LOCAL_REVOKED_TOKEN),
  }));
}

async function readPrivateText(path: string, permissionsCode: string, unreadableCode: string): Promise<string> {
  try {
    const details = await stat(path);
    if (!details.isFile() || (details.mode & 0o777) !== 0o600) throw new Error(permissionsCode);
    const content = await readFile(path, "utf8");
    if (new TextEncoder().encode(content).byteLength > 64 * 1024) throw new Error(unreadableCode);
    return content;
  } catch (error) {
    if (error instanceof Error && (error.message === permissionsCode || error.message === unreadableCode)) throw error;
    throw new Error(unreadableCode);
  }
}

function parsePrivateTokenFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/.exec(line);
    if (!match || seen.has(match[1]!)) throw new Error("MCP_LOCAL_TOKEN_FILE_INVALID");
    const value = match[2]!;
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
      values[match[1]!] = value.slice(1, -1);
    } else if (/\s/.test(value)) {
      throw new Error("MCP_LOCAL_TOKEN_FILE_INVALID");
    } else {
      values[match[1]!] = value;
    }
    seen.add(match[1]!);
  }
  return values;
}

function tokenKey(name: string): string {
  if (name === "reviewer") return "MCP_LOCAL_REVIEWER_TOKEN";
  if (name === "operator") return "MCP_LOCAL_OPERATOR_TOKEN";
  if (name === "viewer") return "MCP_LOCAL_VIEWER_TOKEN";
  throw new Error("MCP_LOCAL_IDENTITY_INVALID");
}

function requireIdentity(identities: readonly (McpLocalSdkIdentity & { readonly revokedToken: string })[], name: "reviewer" | "operator" | "viewer"): McpLocalSdkIdentity & { readonly revokedToken: string } {
  const identity = identities.find((candidate) => candidate.name === name);
  if (!identity) throw new Error("MCP_LOCAL_IDENTITY_MATRIX_INVALID");
  return identity;
}

function validateOptions(options: VerifyMcpLocalOptions): void {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS) throw new Error("MCP_LOCAL_TIMEOUT_INVALID");
  if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > MAX_CALLS) throw new Error("MCP_LOCAL_CALL_BUDGET_INVALID");
  if (typeof options.resolveFixtureId !== "function" || typeof options.readDurableStateForProposal !== "function" || typeof options.sdkFactory !== "function") throw new Error("MCP_LOCAL_VERIFIER_OPTIONS_INVALID");
  if (options.localFakeEnabled !== true) throw new Error("MCP_LOCAL_FAKE_MODE_REQUIRED");
  if (typeof options.probe !== "function") throw new Error("MCP_LOCAL_EDGE_PROBE_REQUIRED");
}

function validateMcpLocalDatabaseUrl(databaseUrl: string): void {
  try {
    validateLocalDatabaseUrl(databaseUrl);
  } catch {
    throw new Error("MCP_LOCAL_DATABASE_INVALID");
  }
}

function fixtureIdValue(ids: McpSmokeFixtureIds, name: McpLocalFixtureIdName): string {
  if (name === "foreignProposal") return ids.proposal.foreign;
  if (name === "viewerProposal") return ids.proposal.viewer;
  if (name === "foreignAggregate") return ids.aggregate.foreign;
  if (name === "viewerAggregate") return ids.aggregate.viewer;
  return ids.revoked.accessTokenId;
}

function assertDurableUuid(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(code);
}

function validateDurableRefs(refs: McpLocalDurableRefs): void {
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) throw new Error("MCP_LOCAL_DURABLE_REFS_MISSING");
  const arrays: readonly (readonly string[])[] = [
    refs.proposalIds,
    refs.intentionIds,
    refs.jobIds,
    refs.outboxIds,
    refs.traceIds,
    refs.attemptTraceIds,
    refs.resultTraceIds,
    refs.reconciliationIds,
  ];
  if (arrays.some((values) => !Array.isArray(values) || values.length > MAX_ITEMS || values.some((value) => !UUID.test(value)))) {
    throw new Error("MCP_LOCAL_DURABLE_REFS_INVALID");
  }
  if (!Array.isArray(refs.terminalStatuses) || refs.terminalStatuses.length > MAX_ITEMS || refs.terminalStatuses.some((value) => typeof value !== "string" || !DURABLE_STATUSES.has(value))) {
    throw new Error("MCP_LOCAL_DURABLE_TERMINAL_STATUS_INVALID");
  }
}

function validateDurableOutboxPayload(
  payload: unknown,
  eventId: string,
  workspaceId: string,
  proposalId: string,
): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("MCP_LOCAL_DURABLE_OUTBOX_PAYLOAD_INVALID");
  const value = payload as Record<string, unknown>;
  if (value.workspaceId !== undefined && value.workspaceId !== workspaceId
    || value.proposalId !== proposalId
    || value.sourceEventId !== eventId
    || typeof value.intentionId !== "string" || !UUID.test(value.intentionId)
    || typeof value.jobId !== "string" || !UUID.test(value.jobId)
    || typeof value.correlationId !== "string" || !UUID.test(value.correlationId)
    || typeof value.aggregateId !== "string" || !UUID.test(value.aggregateId)
    || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length === 0 || value.idempotencyKey.length > 500
    || (value.kind !== "conversation_reply" && value.kind !== "content_publication" && value.kind !== "meeting_proposal" && value.kind !== "campaign_activation")) {
    throw new Error("MCP_LOCAL_DURABLE_OUTBOX_PAYLOAD_INVALID");
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].slice(0, MAX_ITEMS);
}

function validateFixtureIds(ids: McpSmokeFixtureIds, resolveFixtureId: (name: McpLocalFixtureIdName) => string): void {
  const values = [
    ids.proposal.foreign,
    ids.proposal.viewer,
    ids.aggregate.foreign,
    ids.aggregate.viewer,
    ids.content.foreign.assetId,
    ids.content.foreign.publicationId,
    ids.content.foreign.campaignId,
    ids.content.foreign.accountId,
    ids.content.viewer.assetId,
    ids.content.viewer.publicationId,
    ids.content.viewer.campaignId,
    ids.content.viewer.accountId,
    ids.revoked.accessTokenId,
    ids.revoked.familyId,
  ];
  if (values.some((value) => typeof value !== "string" || !UUID.test(value))) throw new Error("MCP_LOCAL_FIXTURE_IDS_INVALID");
  const names: readonly [McpLocalFixtureIdName, string][] = [
    ["foreignProposal", ids.proposal.foreign],
    ["viewerProposal", ids.proposal.viewer],
    ["foreignAggregate", ids.aggregate.foreign],
    ["viewerAggregate", ids.aggregate.viewer],
    ["revokedAccessToken", ids.revoked.accessTokenId],
  ];
  for (const [name, expected] of names) {
    if (resolveFixtureId(name) !== expected) throw new Error("MCP_LOCAL_FIXTURE_ID_MISMATCH");
  }
}

function canonicalResource(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("MCP_LOCAL_RESOURCE_INVALID");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("MCP_LOCAL_RESOURCE_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/mcp" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.href !== value) throw new Error("MCP_LOCAL_RESOURCE_INVALID");
  return parsed.href;
}

function boundedPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("MCP_LOCAL_CONFIG_PATH_INVALID");
  return value;
}

function boundedToken(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new Error("MCP_LOCAL_TOKEN_INVALID");
  return value;
}

function validateIdentityLabels(values: unknown): readonly McpLocalIdentityLabel[] {
  if (!Array.isArray(values) || values.length !== 3) throw new Error("MCP_LOCAL_IDENTITY_MATRIX_INVALID");
  const names = new Set<string>();
  const result = values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP_LOCAL_IDENTITY_INVALID");
    const record = value as Record<string, unknown>;
    if (typeof record.name !== "string" || !SAFE_NAME.test(record.name) || names.has(record.name)) throw new Error("MCP_LOCAL_IDENTITY_INVALID");
    names.add(record.name);
    if (typeof record.workspaceId !== "string" || !UUID.test(record.workspaceId)) throw new Error("MCP_LOCAL_IDENTITY_INVALID");
    if (record.role !== "reviewer" && record.role !== "operator" && record.role !== "viewer") throw new Error("MCP_LOCAL_IDENTITY_INVALID");
    if (!Array.isArray(record.scopes) || record.scopes.some((scope) => scope !== "mcp:read" && scope !== "mcp:write" && scope !== "mcp:approve")) throw new Error("MCP_LOCAL_IDENTITY_INVALID");
    const scopes = record.scopes as McpLocalScope[];
    const expected = record.role === "reviewer" ? ["mcp:read", "mcp:write", "mcp:approve"] : record.role === "operator" ? ["mcp:read", "mcp:write"] : ["mcp:read"];
    if (scopes.length !== expected.length || expected.some((scope) => !scopes.includes(scope as McpLocalScope))) throw new Error("MCP_LOCAL_IDENTITY_SCOPES_INVALID");
    return { name: record.name, workspaceId: record.workspaceId, role: record.role as McpLocalRole, scopes: [...scopes] };
  });
  const reviewer = result.find((identity) => identity.name === "reviewer");
  const operator = result.find((identity) => identity.name === "operator");
  const viewer = result.find((identity) => identity.name === "viewer");
  if (!reviewer || !operator || !viewer
    || reviewer.workspaceId !== operator.workspaceId
    || reviewer.workspaceId === viewer.workspaceId) throw new Error("MCP_LOCAL_IDENTITY_MATRIX_INVALID");
  return result;
}

function workspaceIdsForIdentities(values: readonly McpLocalIdentityLabel[]): readonly [string, string] {
  const identities = validateIdentityLabels(values);
  const reviewer = identities.find((identity) => identity.name === "reviewer");
  const viewer = identities.find((identity) => identity.name === "viewer");
  if (!reviewer || !viewer) throw new Error("MCP_LOCAL_IDENTITY_MATRIX_INVALID");
  return [reviewer.workspaceId, viewer.workspaceId];
}

function validateTools(value: unknown): value is { readonly tools: readonly { readonly name: string }[] } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { tools?: unknown }).tools)) return false;
  const tools = (value as { tools: unknown[] }).tools;
  return tools.length <= MAX_ITEMS && tools.every((tool) => tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string" && boundedBytes((tool as { name: string }).name, 160));
}

function validateResources(value: unknown): value is { readonly resources: readonly { readonly uri: string; readonly name?: string }[] } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { resources?: unknown }).resources)) return false;
  const resources = (value as { resources: unknown[] }).resources;
  return resources.length <= MAX_ITEMS && resources.every((resource) => resource && typeof resource === "object" && typeof (resource as { uri?: unknown }).uri === "string" && boundedBytes((resource as { uri: string }).uri, MAX_URI_BYTES));
}

function validateResourceContents(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { contents?: unknown }).contents)) return false;
  const contents = (value as { contents: unknown[] }).contents;
  return contents.length <= MAX_ITEMS && contents.every((content) => content && typeof content === "object" && typeof (content as { uri?: unknown }).uri === "string" && boundedBytes((content as { uri: string }).uri, MAX_URI_BYTES) && ((content as { text?: unknown }).text === undefined || typeof (content as { text: string }).text === "string" && boundedBytes((content as { text: string }).text, MAX_TEXT_BYTES)));
}

function validateToolResult(value: unknown): value is McpLocalToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { isError?: unknown }).isError !== "boolean" || !Array.isArray((value as { content?: unknown }).content)) return false;
  const content = (value as { content: unknown[] }).content;
  const structured = (value as { structuredContent?: unknown }).structuredContent;
  return content.length <= MAX_ITEMS
    && content.every((item) => item && typeof item === "object" && (item as { type?: unknown }).type !== undefined && boundedBytes(JSON.stringify(item), MAX_TEXT_BYTES))
    && (structured === undefined || boundedStructuredContent(structured) !== null);
}

function appendDurableChecks(checks: McpLocalVerificationCheck[], before: McpLocalDurableState, after: McpLocalDurableState): void {
  const fields: readonly (keyof Pick<McpLocalDurableState, "intentions" | "jobs" | "outbox" | "attempts" | "terminalResults" | "providerBoundaryAttempts">)[] = ["intentions", "jobs", "outbox", "attempts", "terminalResults", "providerBoundaryAttempts"];
  let singleDelta = true;
  for (const field of fields) {
    const delta = after[field] - before[field];
    const exactlyOne = delta === 1;
    singleDelta = singleDelta && exactlyOne;
    checks.push(check(`durable.${field}`, exactlyOne, "MCP_DURABLE_SINGLE", "MCP_DURABLE_NOT_SINGLE"));
  }
  checks.push(check("durable.replay", singleDelta, "MCP_DURABLE_REPLAY_IDEMPOTENT", "MCP_DURABLE_REPLAY_DUPLICATED"));
  checks.push(check("durable.provider_boundary", after.providerBoundaryAttempts - before.providerBoundaryAttempts === 1, "MCP_PROVIDER_BOUNDARY_ATTEMPT_SINGLE", "MCP_PROVIDER_BOUNDARY_ATTEMPT_INVALID"));
}

function validateDurableState(state: McpLocalDurableState): void {
  const values = [state?.intentions, state?.jobs, state?.outbox, state?.attempts, state?.terminalResults, state?.providerBoundaryAttempts, state?.reconciliations];
  if (!state || typeof state !== "object" || values.some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000))) throw new Error("MCP_LOCAL_DURABLE_STATE_INVALID");
  validateDurableRefs(state.refs);
  if (state.proposalStatuses !== undefined && (!Array.isArray(state.proposalStatuses) || state.proposalStatuses.length > MAX_ITEMS || state.proposalStatuses.some((value) => !DURABLE_STATUSES.has(value)))) throw new Error("MCP_LOCAL_DURABLE_STATUS_INVALID");
}

function boundedCounter(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
}

function safeFixtureIds(value: unknown): Readonly<Pick<McpSmokeFixtureIds, "proposal" | "aggregate">> {
  const fallback = "00000000-0000-4000-8000-000000000000";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { proposal: { foreign: fallback, viewer: fallback }, aggregate: { foreign: fallback, viewer: fallback } };
  }
  const record = value as Record<string, unknown>;
  const proposal = record.proposal && typeof record.proposal === "object" && !Array.isArray(record.proposal) ? record.proposal as Record<string, unknown> : {};
  const aggregate = record.aggregate && typeof record.aggregate === "object" && !Array.isArray(record.aggregate) ? record.aggregate as Record<string, unknown> : {};
  const boundedId = (candidate: unknown): string => typeof candidate === "string" && UUID.test(candidate) ? candidate : fallback;
  return {
    proposal: { foreign: boundedId(proposal.foreign), viewer: boundedId(proposal.viewer) },
    aggregate: { foreign: boundedId(aggregate.foreign), viewer: boundedId(aggregate.viewer) },
  };
}

function safeDurableRefs(value: McpLocalDurableRefs): McpLocalDurableRefs {
  const boundedIds = (ids: readonly string[]): readonly string[] => ids.filter((id) => UUID.test(id)).slice(0, MAX_ITEMS);
  const statuses = value.terminalStatuses.filter((status) => DURABLE_STATUSES.has(status)).slice(0, MAX_ITEMS);
  return {
    proposalIds: boundedIds(value.proposalIds),
    intentionIds: boundedIds(value.intentionIds),
    jobIds: boundedIds(value.jobIds),
    outboxIds: boundedIds(value.outboxIds),
    traceIds: boundedIds(value.traceIds),
    attemptTraceIds: boundedIds(value.attemptTraceIds),
    resultTraceIds: boundedIds(value.resultTraceIds),
    reconciliationIds: boundedIds(value.reconciliationIds),
    terminalStatuses: statuses,
  };
}

function safeEffectEvidence(value: McpLocalEffectEvidence): McpLocalEffectEvidence {
  return {
    kind: "content_publication",
    proposalId: UUID.test(value.proposalId) ? value.proposalId : "00000000-0000-4000-8000-000000000000",
    approvalItemId: UUID.test(value.approvalItemId) ? value.approvalItemId : "00000000-0000-4000-8000-000000000000",
    providerBoundaryAttempts: boundedCounter(value.providerBoundaryAttempts) ?? 0,
    beforeRefs: safeDurableRefs(value.beforeRefs),
    afterRefs: safeDurableRefs(value.afterRefs),
    outcomeTraceIds: value.outcomeTraceIds.filter((id) => UUID.test(id)).slice(0, MAX_ITEMS),
    durableRefs: safeDurableRefs(value.durableRefs),
    status: DURABLE_STATUSES.has(value.status) ? value.status : "unknown",
    replayStable: value.replayStable === true,
    reconciliationStable: value.reconciliationStable === true,
    localFakeBoundaryVerified: value.localFakeBoundaryVerified === true,
  };
}

function boundedBytes(value: string, maxBytes: number): boolean {
  return new TextEncoder().encode(value).byteLength <= maxBytes;
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE.test(value) ? value : null;
}

function isBoundedCorrelation(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CORRELATION_BYTES && SAFE_CORRELATION.test(value);
}

function check(name: string, pass: boolean, passCode: string, failCode: string): McpLocalVerificationCheck {
  return { name: name.slice(0, 80), outcome: pass ? "pass" : "fail", code: (pass ? safeCode(passCode) : safeCode(failCode)) ?? "MCP_LOCAL_CHECK_FAILED" };
}

async function main(): Promise<void> {
  const configPath = process.env.MCP_LOCAL_CLIENT_CONFIG_PATH;
  const fixtureKey = process.env.MCP_LOCAL_FIXTURE_KEY;
  const databaseUrl = process.env.MCP_LOCAL_DATABASE_URL ?? process.env.MCP_LOCAL_TEST_DATABASE_URL;
  if (!configPath || !fixtureKey) throw new Error("MCP_LOCAL_VERIFICATION_CONFIG_REQUIRED");
  if (!databaseUrl) throw new Error("MCP_LOCAL_DATABASE_REQUIRED");
  if (process.env.MCP_LOCAL_FAKE_EFFECTS !== "true") throw new Error("MCP_LOCAL_FAKE_MODE_REQUIRED");
  const fixtureIds = resolveMcpSmokeFixtureIds(fixtureKey);
  const config = await loadClientConfig(configPath);
  const identities = await loadSdkIdentities(config);
  const probeIdentity = requireIdentity(identities, "viewer");
  const reader = createMcpLocalDurableStateReader({
    databaseUrl,
    fixtureIds,
    identityLabels: config.identities,
  });
  try {
    const probe = await createMcpLocalEdgeProbe({
      identity: probeIdentity,
      connection: {
        endpoint: config.resource,
        resource: config.resource,
        caPath: config.caPath,
        timeoutMs: Number(process.env.MCP_LOCAL_VERIFY_TIMEOUT_MS ?? "30000"),
        era: "modern",
      },
    });
    const report = await verifyMcpLocal({
      configPath,
      timeoutMs: Number(process.env.MCP_LOCAL_VERIFY_TIMEOUT_MS ?? "30000"),
      maxCalls: Number(process.env.MCP_LOCAL_VERIFY_MAX_CALLS ?? "192"),
      fixtureIds,
      resolveFixtureId: (name) => fixtureIdValue(fixtureIds, name),
      readDurableStateForProposal: reader.readProposal,
      sdkFactory: createMcpLocalSdkFactory,
      probe,
      localFakeEnabled: true,
    });
    console.log(JSON.stringify(report));
    if (report.toolChecks.some((item) => item.outcome === "fail") || report.durableChecks.some((item) => item.outcome === "fail")) process.exitCode = 2;
  } finally {
    await reader.close();
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const code = error instanceof McpLocalVerificationError && SAFE_CODE.test(error.code) ? error.code : "MCP_LOCAL_VERIFICATION_FAILED";
    const report = error instanceof McpLocalVerificationError ? error.report : {
      correlationId: crypto.randomUUID(),
      outcome: "fail" as const,
      code,
      redacted: true as const,
    };
    console.error(JSON.stringify(report));
    process.exitCode = 1;
  });
}
