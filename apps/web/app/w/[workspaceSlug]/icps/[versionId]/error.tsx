"use client";

import { RefreshCcw } from "lucide-react";
import Link from "next/link";

export default function IcpVersionError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <section className="panel w-full max-w-lg p-8 text-center">
        <div className="badge badge-danger mx-auto w-fit">Erreur récupérable</div>
        <h1 className="mt-5 text-2xl font-semibold">L’ICP n’a pas pu être chargé</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Réessayez ou revenez à la liste des ICP canoniques.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button className="button button-primary" onClick={reset} type="button">
            <RefreshCcw size={15} />
            Réessayer
          </button>
          <Link className="button" href="..">Retour</Link>
        </div>
      </section>
    </div>
  );
}
