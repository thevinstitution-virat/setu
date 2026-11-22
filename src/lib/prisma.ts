import { PrismaClient } from "@/generated/prisma/client";

/** Password hashes never leave the database unless a query asks for them (login only). */
// Sign-in secrets never leave the database unless a query selects them by name.
const SECRET_COLUMNS = { passwordHash: true, totpSecret: true, recoveryCodes: true, googleSub: true } as const;
const makeClient = () => new PrismaClient({ omit: { user: SECRET_COLUMNS, platformUser: SECRET_COLUMNS } });

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
