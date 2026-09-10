type AssessmentState = { readonly status: string; readonly recommendation?: string | null };

export function campaignPlanPreparation(assessments: readonly AssessmentState[]) {
  if (assessments.some((item) => item.status === "pending" || item.status === "running")) {
    return {
      label: "Évaluation en cours",
      message: "Les canaux sont encore en cours d’évaluation. La recherche de prospects n’a pas encore démarré.",
    };
  }
  if (assessments.some((item) => item.status === "failed")) {
    return {
      label: "Évaluation bloquée",
      message: "Un canal n’a pas pu être évalué. Aucune recherche de prospects n’a démarré pour cette campagne. Consultez l’erreur du canal ci-dessous.",
    };
  }
  if (assessments.length && assessments.every((item) => item.status === "completed")) {
    return {
      label: "Aucun canal activé",
      message: "L’évaluation des canaux n’a pas activé de campagne. Cela ne signifie pas qu’une recherche complète de prospects a été effectuée.",
    };
  }
  return {
    label: "À préparer",
    message: "Les canaux n’ont pas encore été évalués. La recherche de prospects n’a pas démarré.",
  };
}
