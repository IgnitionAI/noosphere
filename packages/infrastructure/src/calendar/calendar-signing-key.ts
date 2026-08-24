const MINIMUM_SIGNING_KEY_LENGTH = 32;

export function resolveCalendarSigningKey(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.CALENDAR_WEBHOOK_SIGNING_KEY?.trim()
    || environment.BETTER_AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("CALENDAR_WEBHOOK_SIGNING_KEY_OR_BETTER_AUTH_SECRET_REQUIRED");
  }
  if (value.length < MINIMUM_SIGNING_KEY_LENGTH) {
    throw new Error("CALENDAR_WEBHOOK_SIGNING_KEY_TOO_SHORT");
  }
  return value;
}
