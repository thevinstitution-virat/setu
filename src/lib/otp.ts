// Demo OTP store (in-memory). There is no SMS gateway wired up, so the
// generated code is handed back in the API response — this mirrors how the
// original app's own "test credentials" were fixed/shared for demo purposes.

type OtpEntry = { code: string; expiresAt: number };

const store = new Map<string, OtpEntry>();

export function issueOtp(phone: string): string {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  store.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

export function verifyOtp(phone: string, code: string): boolean {
  const entry = store.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(phone);
    return false;
  }
  const ok = entry.code === code;
  if (ok) {
    store.delete(phone);
    verifiedPhones.set(phone, Date.now() + 15 * 60 * 1000);
  }
  return ok;
}

const verifiedPhones = new Map<string, number>();

export function isPhoneVerified(phone: string): boolean {
  const expiry = verifiedPhones.get(phone);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    verifiedPhones.delete(phone);
    return false;
  }
  return true;
}

export function consumeVerifiedPhone(phone: string) {
  verifiedPhones.delete(phone);
}
