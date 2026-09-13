// These limits are consumed by both strict rendering and the document writer.
export interface ContentTextLimit {
  readonly maxCharactersPerLine: number;
  readonly maxLines: number;
}
const limit = (maxCharactersPerLine: number, maxLines: number): ContentTextLimit => ({ maxCharactersPerLine, maxLines });

export const DOCUMENT_ROW_TEXT_LIMITS = {
  title: limit(24, 3), body: limit(54, 4), kicker: limit(45, 1), callout: limit(54, 2),
} as const;
const list = { ...DOCUMENT_ROW_TEXT_LIMITS, itemLabel: limit(50, 2), itemText: limit(52, 5) };

export const DOCUMENT_LAYOUT_TEXT_LIMITS = {
  cover: { title: limit(19, 5), body: limit(34, 4), kicker: limit(24, 1), callout: limit(54, 2) },
  closing: { title: limit(16, 5), body: limit(34, 5), kicker: DOCUMENT_ROW_TEXT_LIMITS.kicker, callout: limit(32, 2), itemLabel: limit(40, 2), itemText: limit(48, 3) },
  insight: { title: limit(24, 4), focus: limit(29, 5), bodyWithCallout: limit(45, 3), kicker: DOCUMENT_ROW_TEXT_LIMITS.kicker },
  checklist: list,
  comparison: { ...DOCUMENT_ROW_TEXT_LIMITS, itemLabel: limit(23, 4), itemText: limit(24, 10), singleItem: list },
  framework: { ...DOCUMENT_ROW_TEXT_LIMITS, itemLabel: limit(23, 2), itemText: limit(24, 5) },
  process: { ...DOCUMENT_ROW_TEXT_LIMITS, itemLabel: limit(42, 2), itemText: limit(44, 5) },
} as const;

export const DOCUMENT_WRITING_LAYOUT_CONSTRAINTS = {
  layouts: DOCUMENT_LAYOUT_TEXT_LIMITS,
  rules: [
    "Apply these field limits on the first draft and every revision. Keep margin below the limits; word wrapping can require extra lines.",
    "Limits are maximum characters per wrapped line and maximum line counts, not target lengths. Do not cut words, URLs or essential reasoning to fit.",
    "Fields also share vertical space. Fitting each field individually does not guarantee the complete page fits; preserve a concise visual hierarchy.",
    "For insight, focus uses callout when present, otherwise body. bodyWithCallout applies to the supporting body only when callout is present.",
    "Comparison uses two columns when at least two items are supplied. With fewer than two items, use comparison.singleItem limits for its full-width row. Four items share two rows and may exceed vertical space even when each field fits.",
    "itemLabel and itemText apply to each item. Cover does not support items. Cover is the first page and closing the last; insight with items renders as checklist.",
    "These are text layout constraints, not evidence or authorization for a factual claim. Keep the public copy and its ledgers synchronized after edits.",
  ],
} as const;
