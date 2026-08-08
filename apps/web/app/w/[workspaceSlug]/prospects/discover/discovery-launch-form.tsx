"use client";

import { Eye, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useFormStatus } from "react-dom";

export function DiscoveryLaunchForm({
  action,
  activeRunHref,
  runsHref,
}: {
  action: (formData: FormData) => void | Promise<void>;
  activeRunHref: string | null;
  runsHref: string;
}) {
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <input
        className="control w-24"
        name="limit"
        type="number"
        min={1}
        max={100}
        defaultValue={25}
        aria-label="Nombre de candidats"
        disabled={Boolean(activeRunHref)}
      />
      <LaunchButton active={Boolean(activeRunHref)} />
      <Link className="button" href={activeRunHref ?? runsHref}>
        {activeRunHref ? <Eye size={14} /> : null}
        {activeRunHref ? "Suivre la recherche" : "Ses runs"}
      </Link>
    </form>
  );
}

function LaunchButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  const busy = active || pending;
  return (
    <button
      aria-live="polite"
      className="button button-signal"
      type="submit"
      disabled={busy}
    >
      {busy ? <LoaderCircle className="animate-spin" size={14} /> : <Search size={14} />}
      {active ? "Recherche en cours" : pending ? "Lancement…" : "Lancer la recherche"}
    </button>
  );
}
