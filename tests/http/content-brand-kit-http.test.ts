import { describe, expect, test } from "bun:test";
import { ContentBrandKitApplication } from "@outbound/application/content/content-brand-kit";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";
import { createContentBrandKitHttpHandler } from "@outbound/interface/http/content-brand-kit-handler";

const workspaceId = crypto.randomUUID();
const userId = crypto.randomUUID();

describe("content brand kit HTTP", () => {
  test("uses the session workspace and validates the complete format mix", async () => {
    const writes: unknown[] = [];
    const application = new ContentBrandKitApplication({
      async find() { return null; },
      async findRequest() { return null; },
      async save(input) { writes.push(input); return { workspaceId, version: 1, snapshot: input.snapshot, updatedAt: input.now }; },
    });
    const handler = createContentBrandKitHttpHandler({ application, contextResolver: context("owner") });
    expect((await handler(request("GET"))).status).toBe(200);
    const response = await handler(request("PUT", { requestKey: "brand-kit-request-1", brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, brandName: "IgnitionAI" }, workspaceId: crypto.randomUUID() }));
    expect(response.status).toBe(422);
    expect(writes).toHaveLength(0);
    const accepted = await handler(request("PUT", { requestKey: "brand-kit-request-2", brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, brandName: "IgnitionAI" } }));
    expect(accepted.status).toBe(200);
    expect(writes).toContainEqual(expect.objectContaining({ workspaceId, userId, snapshot: expect.objectContaining({ brandName: "IgnitionAI" }) }));
  });

  test("allows viewers to inspect but not mutate", async () => {
    const application = new ContentBrandKitApplication({ async find() { return null; } } as never);
    const handler = createContentBrandKitHttpHandler({ application, contextResolver: context("viewer") });
    expect((await handler(request("GET"))).status).toBe(200);
    expect((await handler(request("PUT", { requestKey: "brand-kit-request-3", brandKit: DEFAULT_CONTENT_BRAND_KIT }))).status).toBe(403);
  });

  test("does not expose generative video before a provider is configured", async () => {
    const application = new ContentBrandKitApplication({ async find() { return null; } } as never);
    const handler = createContentBrandKitHttpHandler({ application, contextResolver: context("owner") });
    const response = await handler(request("PUT", {
      requestKey: "brand-kit-request-4",
      brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, videoMode: "generative" },
    }));
    expect(response.status).toBe(422);
  });

  test("imports a tenant-scoped logo and applies the detected palette", async () => {
    const stored: unknown[] = [];
    const application = new ContentBrandKitApplication({
      async find() { return null; },
      async findRequest() { return null; },
      async save(input) { return { workspaceId, version: 1, snapshot: input.snapshot, updatedAt: input.now }; },
    }, {
      async normalize() {
        return {
          bytes: new Uint8Array([1, 2, 3]), width: 120, height: 80,
          previewDataUrl: "data:image/png;base64,AQID",
          colors: { primary: "#111827", accent: "#E11D48", background: "#F7F8F4", text: "#111827" },
        };
      },
    }, { async put(input) { stored.push(input); } });
    const handler = createContentBrandKitHttpHandler({ application, contextResolver: context("owner") });
    const response = await handler(request("POST", {
      requestKey: "brand-logo-request-1",
      fileName: "logo.png",
      mimeType: "image/png",
      dataBase64: "AQID",
    }, "/api/v1/content/brand-kit/logo-import"));
    expect(response.status).toBe(200);
    const body = await response.json() as { snapshot: typeof DEFAULT_CONTENT_BRAND_KIT };
    expect(body.snapshot.colors).toMatchObject({ primary: "#111827", accent: "#E11D48" });
    expect(body.snapshot.logo).toMatchObject({ sourceFileName: "logo.png", width: 120, height: 80 });
    expect(stored).toHaveLength(1);
  });

  test("creates and persists an accessible direction from a securely-read landing page and description", async () => {
    const reads: unknown[] = [];
    const designs: unknown[] = [];
    const application = new ContentBrandKitApplication({
      async find() { return null; },
      async findRequest() { return null; },
      async save(input) { return { workspaceId, version: 1, snapshot: input.snapshot, updatedAt: input.now }; },
    }, undefined, undefined, {
      async design(input) {
        designs.push(input);
        return {
          colors: { primary: "#07133F", accent: "#C8F85A", background: "#F7F8F4", text: "#07133F" },
          typography: "space_grotesk",
          imageStyle: "technical",
          rationale: "Le bleu structure la confiance et le vert signale les actions sans bruit visuel.",
          metadata: { provider: "kimi-code", model: "k3", promptVersion: "test-v1", aiRunId: null },
        };
      },
    }, {
      async read(input) {
        reads.push(input);
        return { url: input.url, title: "IgnitionRAG", markdown: "Plateforme documentaire sécurisée pour les équipes juridiques.", collectedAt: null };
      },
    });
    const handler = createContentBrandKitHttpHandler({ application, contextResolver: context("owner") });
    const response = await handler(request("POST", {
      requestKey: "brand-direction-request-1",
      landingPageUrl: "https://ignitionrag.com",
      description: "Sobre, précis et rassurant pour les directions juridiques.",
      useLogo: false,
    }, "/api/v1/content/brand-kit/generate-direction"));
    expect(response.status).toBe(200);
    const body = await response.json() as { brandKit: { snapshot: typeof DEFAULT_CONTENT_BRAND_KIT }; contrast: { textOnBackground: number } };
    expect(body.brandKit.snapshot.paletteMetadata).toEqual({
      generatedBy: "ai",
      sources: ["landing_page", "description"],
      rationale: "Le bleu structure la confiance et le vert signale les actions sans bruit visuel.",
    });
    expect(body.brandKit.snapshot.websiteUrl).toBe("https://ignitionrag.com");
    expect(body.contrast.textOnBackground).toBeGreaterThanOrEqual(4.5);
    expect(reads).toHaveLength(1);
    expect(designs).toHaveLength(1);
  });
});

function request(method: string, body?: unknown, pathname = "/api/v1/content/brand-kit") { return new Request(`http://localhost${pathname}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function context(role: "viewer" | "owner") { return { async resolve() { return { userId, workspaceId, role }; } }; }
