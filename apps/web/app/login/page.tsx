import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { getSession } from "@/lib/api";

export const metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;
  const destination = next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="w-full max-w-[430px]">
        <div className="mb-8 flex justify-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-navy font-black text-signal">
            N
          </div>
        </div>
        <div className="panel p-7 sm:p-8">
          <div className="badge badge-signal mx-auto w-fit">Espace privé IgnitionAI</div>
          <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight">
            Se connecter à Noosphere
          </h1>
          <p className="mt-2 text-center text-sm leading-6 text-muted">
            Retrouvez vos moteurs Inbound et Outbound dans un espace isolé.
          </p>
          <LoginForm next={destination} />
          <p className="mt-6 text-center text-[11px] leading-5 text-muted">
            Accès réservé aux membres actifs d’un workspace.
          </p>
        </div>
      </section>
    </main>
  );
}
