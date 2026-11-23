/**
 * The signing secrets (sessions, OTP hashes, share links, console cookies).
 *
 * Only local development and the tests may run without one; they get a
 * fixed, public stand-in. Anywhere else — production, a staging copy, a
 * preview, `next start` with NODE_ENV unset — a missing or short secret
 * stops the request instead of quietly signing with a key everyone knows
 * (security report 23 Nov, finding 1). Read it when it's needed, never at
 * import time, so `next build` works without the secrets.
 */

export type SecretName = "SESSION_SECRET" | "PLATFORM_SESSION_SECRET";

const DEV_STAND_IN: Record<SecretName, string> = {
  SESSION_SECRET: "setu-dev-secret-change-me",
  PLATFORM_SESSION_SECRET: "setu-dev-platform-secret",
};

export const MIN_SECRET_LENGTH = 32;

const isDevOrTest = (nodeEnv: string | undefined) => nodeEnv === "development" || nodeEnv === "test";

/** True only for `next dev` and the tests. */
export const devOrTest = () => isDevOrTest(process.env.NODE_ENV);

export function appSecret(name: SecretName, env: Record<string, string | undefined> = process.env): string {
  const value = env[name];
  if (isDevOrTest(env.NODE_ENV)) return value || DEV_STAND_IN[name];
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be set to a random string of at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (value === DEV_STAND_IN.SESSION_SECRET || value === DEV_STAND_IN.PLATFORM_SESSION_SECRET) {
    throw new Error(`${name} is the public development value; set a random one`);
  }
  return value;
}
