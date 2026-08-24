"use client";

import { CircleAlert, RotateCcw } from "lucide-react";

export default function ProductReadingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel p-6 sm:p-8" role="alert">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-danger">
        <CircleAlert size={21} />
      </span>
      <h1 className="mt-5 text-xl font-semibold text-ink">La lecture produit n’a pas pu se charger</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
        Votre workspace est bien enregistré. Réessayez sans perdre votre configuration.
      </p>
      <button className="button button-primary mt-5" onClick={reset} type="button">
        <RotateCcw size={15} /> Réessayer
      </button>
    </section>
  );
}
