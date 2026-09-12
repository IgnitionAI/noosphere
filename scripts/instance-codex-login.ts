import { loginInstanceCodex } from "@outbound/infrastructure/ai/instance-codex-login";
export { loginInstanceCodex };
if (import.meta.main) {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: bun run instance:codex:login <connection-id>");
  await loginInstanceCodex(id, process.env, text => process.stdout.write(text));
  console.log("Connexion ChatGPT enregistrée. Revenez au setup et testez votre modèle.");
}
