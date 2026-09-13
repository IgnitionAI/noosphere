import strategist from "./skills/content-strategist/SKILL.md" with { type: "text" };
import designer from "./skills/deliverable-designer/SKILL.md" with { type: "text" };
import guardian from "./skills/brand-guardian/SKILL.md" with { type: "text" };

// Bun embeds the skill bodies in consuming bundles, independent of runtime cwd.
const body = (skill: string) => skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();

export const contentRuntimeSkills = {
  designer: body(designer),
  strategist: body(strategist),
  guardian: body(guardian),
} as const;
