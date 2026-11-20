import bcrypt from "bcryptjs";

export function hashPassword(plain: string) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compareSync(plain, hash);
}

let dummy: string | null = null;
/** Same work as a real check for an unknown login ID, so timing can't tell which IDs exist. Always false. */
export function burnPasswordCheck(plain: string) {
  dummy ??= bcrypt.hashSync("setu-no-such-user", 10);
  bcrypt.compareSync(plain, dummy);
  return false;
}
