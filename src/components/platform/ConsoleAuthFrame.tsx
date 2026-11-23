import { BrandLockup } from "@/components/BrandMark";

/**
 * The console's sign-in pages in the same frame as a business's sign-in
 * (components/signup/LoginCard.tsx): our logo with "Console" beside it, one
 * centred card, a line of help under it.
 */
export default function ConsoleAuthFrame({
  kick,
  title,
  sub,
  children,
  below,
}: {
  kick: string;
  title: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between gap-3 mb-8">
          <BrandLockup sub="Console" large />
        </div>
        <div className="card card-deco p-6 sm:p-7">
          <p className="page-kick">{kick}</p>
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub mb-6">{sub}</p>}
          {children}
        </div>
        {below && <div className="mt-4 px-1 text-xs text-[var(--muted)]">{below}</div>}
      </div>
    </div>
  );
}
