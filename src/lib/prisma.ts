import { PrismaClient } from "@/generated/prisma/client";

/** Password hashes never leave the database unless a query asks for them (login only). */
const makeClient = () => new PrismaClient({ omit: { user: { passwordHash: true }, platformUser: { passwordHash: true } } });

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
