import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  evaluateProspectMemoryOperatorComprehension,
  prospectMemoryOperatorQuestionIds,
  type ProspectMemoryOperatorQuestionId,
  type ProspectMemoryOperatorResponse,
} from "@outbound/application/prospect-memory/prospect-memory-operator-evaluation";

const responsesPath = required("MEMORY_OPERATOR_RESPONSES");
const outputPath = process.env.MEMORY_OPERATOR_OUTPUT?.trim() || null;
const failOnGate = process.env.MEMORY_OPERATOR_FAIL_ON_GATE !== "false";
const responses = parseResponses(await Bun.file(responsesPath).json());
const evaluation = evaluateProspectMemoryOperatorComprehension(responses);
const report = {
  generatedAt: new Date().toISOString(),
  responsesPath,
  ...evaluation,
  questions: {
    drawer_closure: "Fermer le drawer annule-t-il le job ? Réponse attendue : non, seul le polling navigateur s'arrête.",
    dry_run_effect: "Le dry-run peut-il envoyer ou réserver ? Réponse attendue : non.",
    memory_refresh_effect: "Actualiser la mémoire envoie-t-il un message ? Réponse attendue : non.",
    stale_memory_behavior: "Que fait l'automatisation si la mémoire critique est stale ? Réponse attendue : elle attend et expose la raison.",
    provider_sent_evidence: "Quel état prouve un envoi provider ? Réponse attendue : la commande sent avec son identifiant provider, pas sending/generated.",
  },
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, serialized);
}
process.stdout.write(serialized);
if (failOnGate && !evaluation.gatePassed) process.exitCode = 1;

function parseResponses(value: unknown): ProspectMemoryOperatorResponse[] {
  if (!Array.isArray(value)) throw new Error("MEMORY_OPERATOR_RESPONSES_MUST_BE_AN_ARRAY");
  const validQuestions = new Set<string>(prospectMemoryOperatorQuestionIds);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`MEMORY_OPERATOR_RESPONSE_${index}_INVALID`);
    const record = item as Record<string, unknown>;
    if (typeof record.participantId !== "string" || !Array.isArray(record.answers)) throw new Error(`MEMORY_OPERATOR_RESPONSE_${index}_SHAPE_INVALID`);
    return {
      participantId: record.participantId,
      answers: record.answers.map((answer, answerIndex) => {
        if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new Error(`MEMORY_OPERATOR_RESPONSE_${index}_ANSWER_${answerIndex}_INVALID`);
        const entry = answer as Record<string, unknown>;
        if (typeof entry.questionId !== "string" || !validQuestions.has(entry.questionId) || typeof entry.correct !== "boolean") {
          throw new Error(`MEMORY_OPERATOR_RESPONSE_${index}_ANSWER_${answerIndex}_INVALID`);
        }
        return { questionId: entry.questionId as ProspectMemoryOperatorQuestionId, correct: entry.correct };
      }),
    };
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
