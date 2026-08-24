import { credentials, loadPackageDefinition, type Client, type ServiceError } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import type {
  EmbeddingGateway,
  EmbeddingModelInfo,
  KnowledgeReranker,
  RerankItem,
} from "@outbound/application/knowledge/embedding-gateway";

interface GrpcConstructor {
  new(address: string, credentialsValue: ReturnType<typeof credentials.createInsecure>): Client & Record<string, UnaryMethod>;
}

type UnaryMethod = (request: Record<string, unknown>, callback: (error: ServiceError | null, response: unknown) => void) => void;

interface TeiNamespace {
  readonly v1: {
    readonly Info: GrpcConstructor;
    readonly Embed: GrpcConstructor;
    readonly Rerank: GrpcConstructor;
  };
}

interface TeiInfoResponse {
  readonly modelId?: string;
  readonly modelSha?: string;
  readonly maxInputLength?: number;
}

interface TeiEmbedResponse {
  readonly embeddings?: number[];
}

interface TeiRerankResponse {
  readonly ranks?: { index?: number; score?: number }[];
}

export interface TeiGrpcOptions {
  readonly address: string;
  readonly expectedModelId: string;
  readonly expectedModelSha: string;
  readonly dimension: number;
  readonly timeoutMs?: number;
  readonly queryInstruction?: string;
  readonly maxConcurrency?: number;
  readonly protoPath?: string;
}

export class TeiGrpcEmbeddingGateway implements EmbeddingGateway {
  readonly #info: Client & Record<string, UnaryMethod>;
  readonly #embed: Client & Record<string, UnaryMethod>;
  readonly #timeoutMs: number;
  readonly #maxConcurrency: number;

  constructor(private readonly options: TeiGrpcOptions) {
    const api = loadTei(options.protoPath);
    this.#info = new api.v1.Info(options.address, credentials.createInsecure());
    this.#embed = new api.v1.Embed(options.address, credentials.createInsecure());
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxConcurrency = options.maxConcurrency ?? 4;
  }

  async info(): Promise<EmbeddingModelInfo> {
    const response = await unary<TeiInfoResponse>(this.#info, "info", {}, this.#timeoutMs);
    validateModel(response, this.options);
    return {
      modelId: response.modelId!,
      modelSha: response.modelSha ?? null,
      dimension: this.options.dimension,
      maxInputLength: response.maxInputLength ?? 0,
      healthy: true,
    };
  }

  async embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return mapConcurrent(texts, this.#maxConcurrency, (text) => this.#embedText(text));
  }

  async embedQuery(query: string): Promise<readonly number[]> {
    const instruction = this.options.queryInstruction?.trim();
    return this.#embedText(instruction ? `Instruct: ${instruction}\nQuery: ${query}` : query);
  }

  async #embedText(text: string): Promise<readonly number[]> {
    const response = await unary<TeiEmbedResponse>(this.#embed, "embed", {
      inputs: text,
      truncate: true,
      normalize: true,
      truncationDirection: "TRUNCATION_DIRECTION_RIGHT",
      dimensions: this.options.dimension,
    }, this.#timeoutMs);
    const values = response.embeddings ?? [];
    if (values.length !== this.options.dimension || values.some((value) => !Number.isFinite(value))) {
      throw new Error("TEI_EMBEDDING_DIMENSION_MISMATCH");
    }
    return normalize(values);
  }
}

export class TeiGrpcReranker implements KnowledgeReranker {
  readonly #info: Client & Record<string, UnaryMethod>;
  readonly #rerank: Client & Record<string, UnaryMethod>;
  readonly #timeoutMs: number;

  constructor(private readonly options: TeiGrpcOptions) {
    const api = loadTei(options.protoPath);
    this.#info = new api.v1.Info(options.address, credentials.createInsecure());
    this.#rerank = new api.v1.Rerank(options.address, credentials.createInsecure());
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async info(): Promise<EmbeddingModelInfo> {
    const response = await unary<TeiInfoResponse>(this.#info, "info", {}, this.#timeoutMs);
    validateModel(response, this.options);
    return {
      modelId: response.modelId!,
      modelSha: response.modelSha ?? null,
      dimension: 0,
      maxInputLength: response.maxInputLength ?? 0,
      healthy: true,
    };
  }

  async rerank(input: { readonly query: string; readonly texts: readonly string[] }): Promise<readonly RerankItem[]> {
    if (input.texts.length === 0) return [];
    const response = await unary<TeiRerankResponse>(this.#rerank, "rerank", {
      query: input.query,
      texts: [...input.texts],
      truncate: true,
      rawScores: false,
      returnText: false,
      truncationDirection: "TRUNCATION_DIRECTION_RIGHT",
    }, this.#timeoutMs);
    return (response.ranks ?? []).map((rank) => ({
      index: rank.index ?? -1,
      score: rank.score ?? 0,
    })).filter((rank) => rank.index >= 0 && rank.index < input.texts.length && Number.isFinite(rank.score));
  }
}

function loadTei(protoPath = new URL("./tei.proto", import.meta.url).pathname): TeiNamespace {
  const definition = loadSync(protoPath, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return loadPackageDefinition(definition).tei as unknown as TeiNamespace;
}

function unary<T>(client: Client & Record<string, UnaryMethod>, method: string, request: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const call = client[method];
  if (!call) return Promise.reject(new Error("TEI_GRPC_METHOD_UNAVAILABLE"));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TEI_GRPC_TIMEOUT")), timeoutMs);
    call.call(client, request, (error, response) => {
      clearTimeout(timer);
      if (error) reject(new Error(`TEI_GRPC_UNAVAILABLE:${error.code}`));
      else resolve(response as T);
    });
  });
}

function validateModel(response: TeiInfoResponse, options: TeiGrpcOptions): void {
  if (response.modelId !== options.expectedModelId) throw new Error("TEI_MODEL_ID_MISMATCH");
  if (response.modelSha !== options.expectedModelSha) throw new Error("TEI_MODEL_SHA_MISMATCH");
}

function normalize(values: readonly number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error("TEI_EMBEDDING_INVALID_NORM");
  return values.map((value) => value / norm);
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
