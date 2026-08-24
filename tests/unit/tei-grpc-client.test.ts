import { afterEach, describe, expect, test } from "bun:test";
import { loadPackageDefinition, Server, ServerCredentials, type ServiceDefinition, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import {
  TeiGrpcEmbeddingGateway,
  TeiGrpcReranker,
} from "@outbound/infrastructure/embeddings/tei-grpc-client";

const protoPath = new URL("../../packages/infrastructure/src/embeddings/tei.proto", import.meta.url).pathname;
const definition = loadPackageDefinition(loadSync(protoPath, { defaults: true, enums: String })) as unknown as {
  tei: { v1: Record<string, { service: ServiceDefinition<UntypedServiceImplementation> }> };
};
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.forceShutdown();
});

describe("TEI gRPC adapters", () => {
  test("validates the pinned model and normalizes a 1024-dimension Qwen vector", async () => {
    let observedInput = "";
    const address = await startServer({
      info: callbackHandler(() => ({
        modelId: "Qwen/Qwen3-Embedding-0.6B",
        modelSha: "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3",
        maxInputLength: 32_768,
      })),
      embed: callbackHandler((call) => {
        observedInput = String(call.request.inputs);
        return { embeddings: [3, 4, ...Array.from({ length: 1_022 }, () => 0)] };
      }),
      rerank: callbackHandler(() => ({ ranks: [] })),
    });
    const gateway = new TeiGrpcEmbeddingGateway({
      address,
      expectedModelId: "Qwen/Qwen3-Embedding-0.6B",
      expectedModelSha: "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3",
      dimension: 1_024,
      queryInstruction: "Retrieve bilingual passages.",
      protoPath,
    });

    expect((await gateway.info()).dimension).toBe(1_024);
    const vector = await gateway.embedQuery("contrat de licence");
    expect(vector).toHaveLength(1_024);
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
    expect(observedInput).toBe("Instruct: Retrieve bilingual passages.\nQuery: contrat de licence");
  });

  test("fails closed when TEI returns an incompatible vector dimension", async () => {
    const address = await startServer({
      info: callbackHandler(() => ({ modelId: "Qwen/Qwen3-Embedding-0.6B" })),
      embed: callbackHandler(() => ({ embeddings: [1, 2] })),
      rerank: callbackHandler(() => ({ ranks: [] })),
    });
    const gateway = new TeiGrpcEmbeddingGateway({
      address,
      expectedModelId: "Qwen/Qwen3-Embedding-0.6B",
      expectedModelSha: "unused",
      dimension: 1_024,
      protoPath,
    });
    expect(gateway.embedQuery("test")).rejects.toThrow("TEI_EMBEDDING_DIMENSION_MISMATCH");
  });

  test("maps the multilingual reranker response without retaining request state", async () => {
    const address = await startServer({
      info: callbackHandler(() => ({
        modelId: "BAAI/bge-reranker-v2-m3",
        modelSha: "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
      })),
      embed: callbackHandler(() => ({ embeddings: [] })),
      rerank: callbackHandler(() => ({ ranks: [{ index: 1, score: 0.9 }, { index: 0, score: 0.2 }] })),
    });
    const reranker = new TeiGrpcReranker({
      address,
      expectedModelId: "BAAI/bge-reranker-v2-m3",
      expectedModelSha: "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
      dimension: 0,
      protoPath,
    });
    expect(await reranker.rerank({ query: "preuve", texts: ["A", "B"] })).toEqual([
      { index: 1, score: expect.closeTo(0.9) },
      { index: 0, score: expect.closeTo(0.2) },
    ]);
  });
});

function callbackHandler(factory: (call: { request: Record<string, unknown> }) => unknown) {
  return (call: { request: Record<string, unknown> }, callback: (error: null, value: unknown) => void) => callback(null, factory(call));
}

async function startServer(implementation: UntypedServiceImplementation): Promise<string> {
  const server = new Server();
  servers.push(server);
  server.addService(definition.tei.v1.Info!.service, { info: implementation.info! });
  server.addService(definition.tei.v1.Embed!.service, { embed: implementation.embed! });
  server.addService(definition.tei.v1.Rerank!.service, { rerank: implementation.rerank! });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort));
  });
  return `127.0.0.1:${port}`;
}
