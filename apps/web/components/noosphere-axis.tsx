import Link from "next/link";
import type { NoosphereLens } from "@/lib/api";

const lenses: readonly { readonly value: NoosphereLens; readonly label: string }[] = [
  { value: "inbound", label: "Inbound" },
  { value: "symbiosis", label: "Symbiose" },
  { value: "outbound", label: "Outbound" },
];

export function NoosphereAxis({
  workspaceSlug,
  lens,
  searchParams = {},
}: {
  readonly workspaceSlug: string;
  readonly lens: NoosphereLens;
  readonly searchParams?: Readonly<Record<string, string | undefined>>;
}) {
  return (
    <nav
      aria-label="Noosphere Axis"
      className="mx-auto my-5 grid w-full max-w-[620px] grid-cols-3 gap-1 rounded-full border border-line bg-slate-100 p-1"
      role="tablist"
    >
      {lenses.map((candidate) => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(searchParams)) {
          if (value && key !== "lens" && key !== "cursor") query.set(key, value);
        }
        query.set("lens", candidate.value);
        const selected = candidate.value === lens;
        return (
          <Link
            aria-selected={selected}
            className={`flex min-h-11 min-w-0 items-center justify-center rounded-full px-2 py-2.5 text-center text-xs font-bold transition sm:text-sm ${selected ? "bg-signal text-signal-ink shadow-sm" : "text-muted hover:bg-white hover:text-navy"}`}
            href={`/w/${workspaceSlug}/activity?${query}`}
            key={candidate.value}
            prefetch
            role="tab"
          >
            {candidate.label}
          </Link>
        );
      })}
    </nav>
  );
}
