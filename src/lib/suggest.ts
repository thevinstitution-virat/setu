import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";

/** A new Suggestion (roadmap §7): what an automation proposes, for a person to accept or reject. */
export type NewSuggestion = {
  kind: string;
  subjectType: string;
  subjectId: string;
  title: string;
  detail?: string;
  reasons?: string[];
  payload?: Prisma.InputJsonValue;
  score?: number;
  dedupeKey: string;
  forDate?: string;
  expiresAt?: Date;
};

/** Writes a suggestion unless one with the same key exists (whatever its state). Returns it only when new. */
export async function suggest(tx: Tx, s: NewSuggestion) {
  if (await tx.suggestion.findFirst({ where: { dedupeKey: s.dedupeKey }, select: { id: true } })) return null;
  return tx.suggestion.create({
    data: {
      kind: s.kind,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      title: s.title,
      detail: s.detail ?? "",
      reasons: s.reasons ?? [],
      payload: s.payload ?? {},
      score: Math.max(0, Math.min(100, Math.round(s.score ?? 0))),
      dedupeKey: s.dedupeKey,
      forDate: s.forDate,
      expiresAt: s.expiresAt,
    },
  });
}
