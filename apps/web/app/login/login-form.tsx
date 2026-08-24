"use client";

import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setPending(false);
      setError("Connexion impossible. Vérifiez vos identifiants puis réessayez.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-ink">
          Email professionnel
        </span>
        <input
          className="control"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-ink">
          Mot de passe
        </span>
        <div className="relative">
          <LockKeyhole
            aria-hidden
            className="absolute left-3 top-2.5 text-muted"
            size={17}
          />
          <input
            className="control control-icon"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
          />
        </div>
      </label>
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <button className="button button-primary w-full" disabled={pending} type="submit">
        {pending ? <LoaderCircle className="animate-spin" size={17} /> : <ArrowRight size={17} />}
        {pending ? "Connexion…" : "Accéder au workspace"}
      </button>
    </form>
  );
}
