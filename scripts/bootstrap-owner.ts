import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createBetterAuthRuntime } from "@outbound/infrastructure/auth/better-auth-runtime";
import { createDatabase, type Database } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  workspaces,
  workspaceMembers,
} from "@outbound/infrastructure/database/schema";

const bootstrapOwnerSchema = z.object({
  baseUrl: z.url(),
  secret: z.string().min(32),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(128),
  workspaceSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  workspaceName: z.string().trim().min(1).max(200),
});

export type BootstrapOwnerInput = z.input<typeof bootstrapOwnerSchema>;

export async function bootstrapOwner(db: Database, input: BootstrapOwnerInput) {
  const values = bootstrapOwnerSchema.parse(input);
  let [user] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(sql<string>`lower(${authUsers.email})`, values.email))
    .limit(1);

  if (!user) {
    const auth = createBetterAuthRuntime(db, {
      baseUrl: values.baseUrl,
      secret: values.secret,
      trustedOrigins: [new URL(values.baseUrl).origin],
      allowSignUp: true,
    });
    const response = await auth.handle(
      new Request(new URL("/api/auth/sign-up/email", values.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(values.baseUrl).origin,
        },
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          password: values.password,
        }),
      }),
    );
    if (!response.ok) {
      throw new Error(`OWNER_BOOTSTRAP_SIGN_UP_FAILED:${response.status}`);
    }
    [user] = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(sql<string>`lower(${authUsers.email})`, values.email))
      .limit(1);
  }
  if (!user) throw new Error("OWNER_BOOTSTRAP_USER_NOT_FOUND");

  await db
    .insert(workspaces)
    .values({
      slug: values.workspaceSlug,
      name: values.workspaceName,
    })
    .onConflictDoNothing({ target: workspaces.slug });
  const [workspace] = await db
    .select({
      id: workspaces.id,
      status: workspaces.status,
      deletedAt: workspaces.deletedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.slug, values.workspaceSlug))
    .limit(1);
  if (!workspace || workspace.status !== "active" || workspace.deletedAt) {
    throw new Error("OWNER_BOOTSTRAP_WORKSPACE_UNAVAILABLE");
  }

  await db
    .insert(workspaceMembers)
    .values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
      status: "active",
    })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { role: "owner", status: "active" },
    });

  return { userId: user.id, workspaceId: workspace.id, workspaceSlug: values.workspaceSlug };
}

if (import.meta.main) {
  const database = createDatabase(requiredEnvironment("DATABASE_URL"));
  try {
    const result = await bootstrapOwner(database.db, {
      baseUrl: requiredEnvironment("BETTER_AUTH_URL"),
      secret: requiredEnvironment("BETTER_AUTH_SECRET"),
      email: requiredEnvironment("BOOTSTRAP_OWNER_EMAIL"),
      name: requiredEnvironment("BOOTSTRAP_OWNER_NAME"),
      password: requiredEnvironment("BOOTSTRAP_OWNER_PASSWORD"),
      workspaceSlug: requiredEnvironment("BOOTSTRAP_WORKSPACE_SLUG"),
      workspaceName: requiredEnvironment("BOOTSTRAP_WORKSPACE_NAME"),
    });
    console.info(JSON.stringify({ event: "owner_bootstrapped", ...result }));
  } finally {
    await database.close();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
