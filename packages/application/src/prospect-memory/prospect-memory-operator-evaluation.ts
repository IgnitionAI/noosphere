export const prospectMemoryOperatorQuestionIds = [
  "drawer_closure",
  "dry_run_effect",
  "memory_refresh_effect",
  "stale_memory_behavior",
  "provider_sent_evidence",
] as const;

export type ProspectMemoryOperatorQuestionId = (typeof prospectMemoryOperatorQuestionIds)[number];

export interface ProspectMemoryOperatorResponse {
  readonly participantId: string;
  readonly answers: readonly {
    readonly questionId: ProspectMemoryOperatorQuestionId;
    readonly correct: boolean;
  }[];
}

export interface ProspectMemoryOperatorEvaluation {
  readonly schemaVersion: 1;
  readonly participantCount: number;
  readonly validParticipantCount: number;
  readonly invalidParticipantCount: number;
  readonly correctAnswerCount: number;
  readonly answerCount: number;
  readonly comprehensionRate: number | null;
  readonly criticalMisunderstandingCount: number;
  readonly gatePassed: boolean;
  readonly minimumComprehensionRate: 0.9;
}

const criticalQuestions = new Set<ProspectMemoryOperatorQuestionId>([
  "dry_run_effect",
  "memory_refresh_effect",
  "provider_sent_evidence",
]);

/**
 * Scores the five effect-boundary questions used in the operator test. The
 * gate requires at least 90% overall and zero safety-critical misconception.
 */
export function evaluateProspectMemoryOperatorComprehension(
  responses: readonly ProspectMemoryOperatorResponse[],
): ProspectMemoryOperatorEvaluation {
  const expected = new Set<string>(prospectMemoryOperatorQuestionIds);
  let validParticipantCount = 0;
  let invalidParticipantCount = 0;
  let correctAnswerCount = 0;
  let answerCount = 0;
  let criticalMisunderstandingCount = 0;
  const participants = new Set<string>();

  for (const response of responses) {
    const answers = new Map(response.answers.map((answer) => [answer.questionId, answer.correct]));
    const valid = Boolean(response.participantId.trim())
      && !participants.has(response.participantId)
      && answers.size === expected.size
      && [...answers.keys()].every((questionId) => expected.has(questionId));
    participants.add(response.participantId);
    if (!valid) {
      invalidParticipantCount += 1;
      continue;
    }
    validParticipantCount += 1;
    for (const [questionId, correct] of answers) {
      answerCount += 1;
      if (correct) correctAnswerCount += 1;
      else if (criticalQuestions.has(questionId)) criticalMisunderstandingCount += 1;
    }
  }
  const comprehensionRate = answerCount === 0 ? null : correctAnswerCount / answerCount;
  return {
    schemaVersion: 1,
    participantCount: responses.length,
    validParticipantCount,
    invalidParticipantCount,
    correctAnswerCount,
    answerCount,
    comprehensionRate,
    criticalMisunderstandingCount,
    gatePassed: responses.length > 0
      && validParticipantCount === responses.length
      && invalidParticipantCount === 0
      && comprehensionRate !== null
      && comprehensionRate >= 0.9
      && criticalMisunderstandingCount === 0,
    minimumComprehensionRate: 0.9,
  };
}
