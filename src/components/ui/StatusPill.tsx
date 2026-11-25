import { STATUS_COLOR } from "@/lib/orders";
import type { OrderStatus } from "@/generated/prisma/client";

export type PillTone = "money" | "scheme" | "risk" | "success" | "accent" | "neutral";

const TONE: Record<PillTone, string> = {
  money: "chip-money",
  scheme: "chip-scheme",
  risk: "chip-risk",
  success: "chip-mint",
  accent: "chip-kesar",
  neutral: "chip-neutral",
};

/** An order status (mapped from the existing .st-* classes) or a plain toned label. */
export default function StatusPill({
  status,
  tone,
  children,
  className = "",
}: {
  status?: OrderStatus;
  tone?: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  const cls = status ? STATUS_COLOR[status] : `chip ${TONE[tone ?? "neutral"]}`;
  return <span className={`${status ? "chip" : ""} ${cls} !py-0.5 !text-[12px] ${className}`}>{children}</span>;
}
