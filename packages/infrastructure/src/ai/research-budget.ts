import type { ProductResearchBrief } from "@outbound/domain/gtm/product-research";

export interface ResearchBudgetLimits {
  readonly searches: number;
  readonly pages: number;
  readonly tokens: number;
  readonly durationMs: number;
}

export const researchBudgetLimits: Readonly<
  Record<ProductResearchBrief["depth"], ResearchBudgetLimits>
> = {
  // Token budgets account for agentic loops: every model call re-sends the
  // full conversation, and thinking models add reasoning tokens on each call.
  // Kimi Code is subscription-billed, so these limits are a runaway safeguard,
  // not a per-token cost control.
  quick: { searches: 15, pages: 40, tokens: 300_000, durationMs: 10 * 60_000 },
  standard: { searches: 40, pages: 120, tokens: 900_000, durationMs: 30 * 60_000 },
  deep: { searches: 100, pages: 300, tokens: 2_000_000, durationMs: 75 * 60_000 },
};

export class ResearchBudgetExceededError extends Error {
  constructor(readonly resource: keyof ResearchBudgetLimits) {
    super(`Research budget exhausted for ${resource}`);
    this.name = "ResearchBudgetExceededError";
  }
}

export class ResearchBudget {
  readonly #startedAt = Date.now();
  #searches = 0;
  #pages = 0;
  #tokens = 0;

  readonly #softTokens: boolean;

  constructor(
    readonly limits: ResearchBudgetLimits,
    options?: { softTokens?: boolean },
  ) {
    this.#softTokens = options?.softTokens === true;
  }

  consumeSearches(count = 1): void {
    this.#ensureDuration();
    if (this.#searches + count > this.limits.searches) {
      throw new ResearchBudgetExceededError("searches");
    }
    this.#searches += count;
  }

  consumePages(count = 1): void {
    this.#ensureDuration();
    if (this.#pages + count > this.limits.pages) {
      throw new ResearchBudgetExceededError("pages");
    }
    this.#pages += count;
  }

  recordTokens(count: number): void {
    this.#tokens += Math.max(0, count);
    // With subscription-billed providers (Kimi Code), token accounting is an
    // observability signal: searches, pages and duration remain hard caps.
    if (!this.#softTokens && this.#tokens > this.limits.tokens) {
      throw new ResearchBudgetExceededError("tokens");
    }
  }

  remainingDurationMs(): number {
    return Math.max(0, this.limits.durationMs - (Date.now() - this.#startedAt));
  }

  snapshot(): Readonly<Record<string, number>> {
    return {
      searches: this.#searches,
      pages: this.#pages,
      tokens: this.#tokens,
      elapsedMs: Date.now() - this.#startedAt,
      searchLimit: this.limits.searches,
      pageLimit: this.limits.pages,
      tokenLimit: this.limits.tokens,
      durationLimitMs: this.limits.durationMs,
    };
  }

  #ensureDuration(): void {
    if (this.remainingDurationMs() === 0) {
      throw new ResearchBudgetExceededError("durationMs");
    }
  }
}
