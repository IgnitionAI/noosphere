/** Shared by the production writer, auditor and critic. Changes require real-output evaluation. */
export const editorialPlaybook = {
  brief: [
    'Use businessContext.offer and businessContext.icp: identify one reader problem and the decision this post helps make. A strategy summary alone is not the offer.',
    'Make the angle a worked reader decision: identify a concrete situation, what the reader should inspect, and how alternative observations change their next action. A list of categories without an application example is an incomplete brief.',
    'Choose an angle that yields a useful diagnostic, explained tradeoff, worked example or actionable method. A quotation or summary of a source alone is not reader value.',
    'A CTA in the strategy is a suggestion, not proof that a grid, guide, demo, audit or other promised deliverable exists. With no verified resource, use a relevant question or no CTA.',
  ],
  writer: [
    'Deliver the value in the post itself before requesting anything from the reader: explain a specific decision, show a useful example or offer an actionable check with its limits.',
    'Use the source as support for reasoning, not as the substance of a quotation collage. When referring to a guide, study or report, identify its title or author and give its supplied canonical URL when available. Never invent attribution.',
    'You may propose a method or a clearly labelled hypothetical example without pretending it is a measured result or personal experience. Do not invent customers, results, stories or product capabilities.',
    'Do not promise a resource merely because strategy.callsToAction suggests it. Unless supplied evidence proves its existence and availability, use a question grounded in the post or null.',
    'For proposed methods, demonstrate the operation on a compact explicitly fictional example instead of claiming that the method improves, guarantees or enables a result. Show the input, the observation and the proposed next step. Keep source findings separate from your proposal; a source about the same topic does not validate your method.',
    'When using invented numeric inputs in a worked example, include the exact complete passage in illustrativeScenarios (max two, 600 characters each), beginning with Exemple fictif :. Keep these invented inputs separate from factualClaims. This does not permit fabricated customers, performance, product capabilities or adjacent unsourced facts. Otherwise return an empty illustrativeScenarios array.',
    'During repair preserve the useful reasoning and takeaway. Removing unsupported claims must not leave a hollow summary. Reframe as an honest proposed method or acknowledge the material is insufficient rather than pad or imply new facts.',
  ],
  audit: [
    'Distinguish a proposed method or explicitly hypothetical scenario from a claim about real results, product capabilities or established facts. A recommendation does not require an invented external citation; its factual premises still do.',
    'For each supplied factualClaims item, copy its statement exactly, including punctuation and any URL, into reviewedClaims.statement. Do not paraphrase it, shorten it or replace it with an inferred claim. You may add separately identified factual claims omitted by the writer. This exact reference allows the independent audit to be associated with the claim actually submitted.',
    'A normative recommendation or a logical distinction demonstrated by a hypothetical counterexample is editorial reasoning, not a measurement. Do not demand an external study merely for a proposed rule of caution. Still audit every empirical premise, factual attribution, product capability or promised effect; a normative label never exempts adjacent facts.',
    'Independently assess each draft.illustrativeScenarios item in reviewedScenarios, copying its exact statement. Verdict hypothetical requires an explicitly labelled invented input used to explain a decision, with no implied real outcome, customer success or product capability. Use misleading otherwise and explain the unsupported implication. A fictitious label alone is not proof. Still audit empirical statements outside the example normally. Return an empty array when there are no declared scenarios.',
    'Audit promised deliverables and calls to action as claims. Listing a CTA in the strategy does not establish that the promised resource exists or is available.',
  ],
  critic: [
    'Complete qualityAssessment for all seven criteria. For each, give pass or revise, a specific reason, and exact excerpts from the current body or current media copy only. Compare historical posts in reason; never copy historical passages into excerpts. Missing qualities can be explained against the closest relevant passage. Do not invent excerpts.',
    'audienceRelevance: does this address a concrete problem or decision of businessContext.icp and fit the actual offer scope?',
    'readerValue: what can the reader understand, decide or do after reading? Reject mere source summaries, quotation collages or generic recommendations without explanation. A useful short method can pass; length is not value.',
    'coherence: does the opening lead through a clear explanation to the takeaway? Reject unexplained jumps between prompting, governance, deployment or other adjacent topics.',
    'sourceAttribution: can the reader identify a cited guide, study or quotation? Reject anonymous references such as a guide with no identifiable source. Pure proposed advice without external claims can pass; explain why.',
    'ctaTruthfulness: is there one proportionate, honest reader CTA, without competing requests? Diagnostic questions within a useful method and question marks in source titles are not separate CTAs. Reject a promised grid, report or other resource without evidence of availability, even if it was suggested by the strategy. An appropriate question or no CTA can pass.',
    'brandVoice: is the public copy natural and consistent with the supplied identity, without invented experience, fake intimacy, audit narration or interchangeable promotional language?',
    'distinctness: compare the problem, mechanism and takeaway against recentBodies. Cite the current passage and explain the closest overlap or meaningful difference; if history is empty, state that explicitly. Rephrasing the same advice is not a new post.',
    'A revise verdict blocks readiness regardless of the summary. Give useful repair directions rather than simply telling the writer to be more specific. Pass requires substantive quality, not just absence of factual errors.',
  ],
} as const;
