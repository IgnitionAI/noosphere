import type { ResearchRunSummary } from "../../../../../lib/api";

export interface ProductReadingPageState {
  readonly runs: readonly ResearchRunSummary[];
  readonly historyUnavailable: boolean;
}

export async function loadProductReadingPageState(
  loadRuns: () => Promise<readonly ResearchRunSummary[]>,
): Promise<ProductReadingPageState> {
  try {
    return { runs: await loadRuns(), historyUnavailable: false };
  } catch {
    return { runs: [], historyUnavailable: true };
  }
}
