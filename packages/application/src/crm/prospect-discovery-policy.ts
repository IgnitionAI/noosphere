export function buildProspectSearchFilters(
  version: { criteria: unknown; buyingCommittee: unknown },
  limit: number,
): {
  api: "classic";
  category: "people";
  keywords: string;
  limit: number;
  enrichContacts: false;
} {
  const criteria = objectRecord(version.criteria);
  const industries = [...stringArray(criteria.sectors), ...stringArray(criteria.industries)];
  const committee = stringArray(version.buyingCommittee);
  const industry = (industries[0] ?? "").split("/")[0]!.trim().split(/\s+/).slice(0, 2).join(" ");
  const role = (committee[0] ?? "").split("/")[0]!.trim().split(/\s+/).slice(0, 2).join(" ");
  const keywords = [industry, role].filter(Boolean).join(" ").trim();
  return { api: "classic", category: "people", keywords, limit, enrichContacts: false };
}

export function computeProspectIcpFit<TCandidate extends {
  headline: string | null;
  companyName: string | null;
  location: string | null;
}>(
  version: { criteria: unknown; buyingCommittee: unknown },
  candidate: TCandidate,
): { matches: string[]; gaps: string[] } {
  const criteria = objectRecord(version.criteria);
  const matches: string[] = [];
  const gaps: string[] = [];
  const haystack = `${candidate.headline ?? ""} ${candidate.companyName ?? ""}`.toLowerCase();
  const geography = typeof criteria.geography === "string" ? criteria.geography : null;
  if (geography) {
    const location = (candidate.location ?? "").toLowerCase();
    if (location && location.includes(geography.toLowerCase())) {
      matches.push(`Géographie : ${geography}`);
    } else {
      gaps.push(
        candidate.location
          ? `Géographie à vérifier : ${candidate.location} (critère ${geography})`
          : "Géographie inconnue",
      );
    }
  }
  const industries = [...stringArray(criteria.sectors), ...stringArray(criteria.industries)];
  const matchedSectors = industries.filter((sector) => haystack.includes(sector.toLowerCase()));
  if (matchedSectors.length) matches.push(`Secteur : ${matchedSectors.join(", ")}`);
  else if (industries.length) gaps.push("Secteur non confirmé par le profil");
  const committee = stringArray(version.buyingCommittee);
  const matchedRole = committee.find((role) => {
    const cleaned = role.split("/")[0]!.trim().toLowerCase();
    return cleaned.length > 0 && haystack.includes(cleaned);
  });
  if (matchedRole) matches.push(`Rôle : ${matchedRole.split("/")[0]!.trim()}`);
  else if (committee.length) gaps.push("Rôle non confirmé par le profil");
  return { matches, gaps };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}
