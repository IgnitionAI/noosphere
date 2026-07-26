const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeDomain(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  const domain = host.replace(/^www\./i, "").toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error("INVALID_COMPANY_DOMAIN");
  }
  return domain;
}

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("INVALID_CONTACT_EMAIL");
  }
  return email;
}

export function normalizeLinkedinUrl(input: string): string {
  const trimmed = input.trim();
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const withoutWww = withoutScheme.replace(/^www\./i, "");
  const path = withoutWww.split(/[?#]/, 1)[0] ?? "";
  const normalized = path.replace(/\/+$/, "").toLowerCase();
  if (!normalized.startsWith("linkedin.com/") || normalized.length <= "linkedin.com/".length) {
    throw new Error("INVALID_LINKEDIN_URL");
  }
  return normalized;
}

export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const digitCount = digits.replace(/\D/g, "").length;
  if (digitCount < 6) {
    throw new Error("INVALID_PHONE_NUMBER");
  }
  return digits;
}
