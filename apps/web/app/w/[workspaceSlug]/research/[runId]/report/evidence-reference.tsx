"use client";

export function EvidenceReference({
  evidenceId,
  label,
}: {
  evidenceId: string;
  label: string;
}) {
  function focusEvidence() {
    const target = document.getElementById(`evidence-${evidenceId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  return (
    <button
      aria-controls={`evidence-${evidenceId}`}
      className="badge max-w-full cursor-pointer whitespace-normal break-words text-left hover:border-brand-blue hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue"
      onClick={focusEvidence}
      type="button"
    >
      {label}
    </button>
  );
}
