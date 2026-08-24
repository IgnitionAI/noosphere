export interface EmbeddingModelInfo {
  readonly modelId: string;
  readonly modelSha: string | null;
  readonly dimension: number;
  readonly maxInputLength: number;
  readonly healthy: boolean;
}

export interface EmbeddingGateway {
  info(): Promise<EmbeddingModelInfo>;
  embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  embedQuery(query: string): Promise<readonly number[]>;
}

export interface RerankItem {
  readonly index: number;
  readonly score: number;
}

export interface KnowledgeReranker {
  info(): Promise<EmbeddingModelInfo>;
  rerank(input: {
    readonly query: string;
    readonly texts: readonly string[];
  }): Promise<readonly RerankItem[]>;
}
