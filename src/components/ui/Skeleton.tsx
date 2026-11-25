/** Loading placeholders shaped like the real cards (shimmer; no spinners on primary screens). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ProductCardSkeleton() {
  return (
    <div className="card p-2.5 space-y-2" aria-hidden="true">
      <Skeleton className="aspect-[1.15] w-full" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function RowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card p-3 flex items-center gap-3">
          <Skeleton className="h-12 w-12 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatSkeletons({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-[var(--r-lg)]" />
      ))}
    </div>
  );
}
