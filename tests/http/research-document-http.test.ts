import { describe, expect, test } from "bun:test";
import {
  createResearchDocumentHttpHandler,
  type ResearchDocumentHttpService,
} from "@outbound/interface/http/research-document-handler";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-25T10:00:00.000Z");

function harness(role: "viewer" | "operator" = "operator") {
  const calls: string[] = [];
  const document = {
    id: documentId,
    filename: "offre.pdf",
    contentType: "application/pdf",
    sizeBytes: 100,
    checksumSha256: "a".repeat(64),
    status: "uploading",
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
  const service: ResearchDocumentHttpService = {
    async createUploadIntent(input) {
      calls.push(`create:${input.workspaceId}`);
      return {
        document,
        uploadUrl: "https://objects.example.test/upload",
        expiresInSeconds: 900,
      };
    },
    async completeUpload(input) {
      calls.push(`complete:${input.workspaceId}:${input.documentId}`);
      return { ...document, status: "uploaded" };
    },
    async list(inputWorkspaceId) {
      calls.push(`list:${inputWorkspaceId}`);
      return [document];
    },
    async softDelete(inputWorkspaceId, inputDocumentId) {
      calls.push(`delete:${inputWorkspaceId}:${inputDocumentId}`);
    },
  };
  return {
    calls,
    handle: createResearchDocumentHttpHandler({
      service,
      contextResolver: {
        async resolve() {
          return {
            userId: "33333333-3333-4333-8333-333333333333",
            workspaceId,
            role,
          };
        },
      },
    }),
  };
}

describe("research document HTTP routes", () => {
  test("creates a workspace-scoped direct upload intent", async () => {
    const { handle, calls } = harness();
    const response = await handle(
      new Request("http://localhost/api/v1/research-documents/upload-intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "offre.pdf",
          contentType: "application/pdf",
          sizeBytes: 100,
          checksumSha256: "a".repeat(64),
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(calls).toEqual([`create:${workspaceId}`]);
  });

  test("a viewer can list but cannot complete a document upload", async () => {
    const { handle, calls } = harness("viewer");
    expect(
      (await handle(new Request("http://localhost/api/v1/research-documents"))).status,
    ).toBe(200);
    const forbidden = await handle(
      new Request(
        `http://localhost/api/v1/research-documents/${documentId}/complete`,
        { method: "POST" },
      ),
    );
    expect(forbidden.status).toBe(403);
    expect(calls).toEqual([`list:${workspaceId}`]);
  });
});
