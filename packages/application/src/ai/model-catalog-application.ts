import {
  aiProviderIds,
  type AiProviderId,
  type ModelCatalog,
  type ModelCatalogSnapshot,
} from "@outbound/application/ai/model-gateway";

export class ModelCatalogApplication {
  readonly #catalogs: ReadonlyMap<AiProviderId, ModelCatalog>;

  constructor(catalogs: readonly ModelCatalog[], private readonly now: () => Date = () => new Date()) {
    this.#catalogs = new Map(catalogs.map((catalog) => [catalog.provider, catalog]));
  }

  async list(signal?: AbortSignal): Promise<readonly ModelCatalogSnapshot[]> {
    return Promise.all(aiProviderIds.map(async (provider) => {
      const catalog = this.#catalogs.get(provider);
      if (!catalog) {
        return {
          provider,
          status: "unavailable" as const,
          models: [],
          observedAt: this.now(),
          errorCode: "AI_PROVIDER_CATALOG_UNAVAILABLE" as const,
        };
      }
      return catalog.list(signal);
    }));
  }
}
