import { ORDER_STATUS_FLOW } from "@/lib/orders";
import { tr } from "@/lib/i18n/server";
import type { Lang, DictKey } from "@/lib/i18n/dictionary";
import type { OrderStatus } from "@/generated/prisma/client";

type Event = { status: OrderStatus; createdAt: Date | string; note?: string | null };

export default function OrderTimeline({
  events,
  currentStatus,
  lang = "en",
}: {
  events: Event[];
  currentStatus: OrderStatus;
  lang?: Lang;
}) {
  const eventMap = new Map(events.map((e) => [e.status, e]));

  if (currentStatus === "CANCELLED") {
    return (
      <div className="space-y-3">
        {events.map((e, i) => (
          <TimelineRow
            key={i}
            label={tr(`status.${e.status}` as DictKey, lang)}
            time={e.createdAt}
            done
            note={e.note}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ORDER_STATUS_FLOW.map((status) => {
        const event = eventMap.get(status);
        return (
          <TimelineRow
            key={status}
            label={tr(`status.${status}` as DictKey, lang)}
            time={event?.createdAt}
            done={!!event}
            note={event?.note}
          />
        );
      })}
    </div>
  );
}

function TimelineRow({
  label,
  time,
  done,
  note,
}: {
  label: string;
  time?: Date | string;
  done: boolean;
  note?: string | null;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`h-3 w-3 rounded-full ${done ? "bg-brand" : "bg-black/15"}`} />
        <div className="w-px flex-1 bg-black/10" />
      </div>
      <div className="pb-3">
        <p className={`text-sm font-medium ${done ? "" : "text-foreground/40"}`}>{label}</p>
        {time && (
          <p className="text-xs text-foreground/50">
            {new Date(time).toLocaleString()}
          </p>
        )}
        {note && <p className="text-xs text-foreground/50">{note}</p>}
      </div>
    </div>
  );
}
