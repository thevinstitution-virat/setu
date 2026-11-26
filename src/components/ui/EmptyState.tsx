import Link from "next/link";
import { Icon3D } from "@/components/icons3d/Icon3D";
import type { Icon3DName } from "@/lib/ui/icons3d";

/** Icon3D, a title, one line of text, one action. Used wherever a list can be empty. */
export default function EmptyState({
  icon = "box-sealed",
  title,
  text,
  action,
  className = "",
}: {
  icon?: Icon3DName;
  title: string;
  text?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center text-center gap-1.5 px-4 py-8 ${className}`}>
      <Icon3D name={icon} size={120} animate="pop" interactive />
      <p className="font-heading font-bold text-lg mt-2">{title}</p>
      {text && <p className="text-sm text-[var(--muted)] max-w-[34ch]">{text}</p>}
      {action &&
        (action.href ? (
          <Link href={action.href} className="btn btn-primary btn-sm mt-3">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="btn btn-primary btn-sm mt-3">
            {action.label}
          </button>
        ))}
    </div>
  );
}
