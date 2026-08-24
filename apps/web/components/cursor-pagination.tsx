import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

export function CursorPagination({
  previousHref,
  nextHref,
  page,
}: {
  previousHref?: string | undefined;
  nextHref?: string | undefined;
  page: number;
}) {
  if (!previousHref && !nextHref) return null;
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="Pagination">
      {previousHref ? (
        <Link className="button" href={previousHref}>
          <ChevronLeft size={14} /> Précédent
        </Link>
      ) : <span />}
      <span className="text-xs text-muted">Page {page}</span>
      {nextHref ? (
        <Link className="button" href={nextHref}>
          Suivant <ChevronRight size={14} />
        </Link>
      ) : <span />}
    </nav>
  );
}
