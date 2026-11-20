import { engageRead, engageWrite } from "@/lib/engage-api";
import { checkTemplate, EVENTS, isEventKey, placeholders } from "@/lib/notify-events";
import { eventOn, notifySettings, CHANNELS } from "@/lib/engage-settings";
import { MoneyError } from "@/lib/money-error";

/** GET → every message: built-in wording (EN / HI), this business's own wording, channels it goes on. */
export async function GET() {
  return engageRead("messages.manage", async (ctx) => {
    const [own, t] = await Promise.all([
      ctx.tx.messageTemplate.findMany(),
      ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
    ]);
    const s = notifySettings(t?.settings);
    return {
      items: (Object.keys(EVENTS) as (keyof typeof EVENTS)[]).map((event) => {
        const d = EVENTS[event];
        return {
          event,
          label: d.label,
          audience: d.audience,
          topic: "topic" in d ? d.topic : null,
          vars: d.vars,
          defaults: { en: d.en, hi: d.hi },
          own: Object.fromEntries(own.filter((o) => o.event === event).map((o) => [o.lang, { title: o.title, body: o.body, waTemplate: o.waTemplate, dltId: o.dltId, params: placeholders(o.body) }])),
          defaultChannels: d.channels,
          on: Object.fromEntries(CHANNELS.map((c) => [c, d.audience === "staff" && c !== "push" ? false : eventOn(s, event, c)])),
        };
      }),
    };
  });
}

/** Body: { event, lang, title, body, waTemplate?, dltId? } → this business's own wording. */
export async function PUT(req: Request) {
  return engageWrite(
    req,
    "template.save",
    "messages.manage",
    async (ctx, b) => {
      if (!isEventKey(b.event)) throw new MoneyError("Unknown message");
      if (b.lang !== "en" && b.lang !== "hi") throw new MoneyError("Pick English or Hindi");
      if (b.event === "announcement" || b.event === "staff.announcement") throw new MoneyError("Announcements are written each time");
      const title = typeof b.title === "string" ? b.title.trim() : "";
      const body = typeof b.body === "string" ? b.body.trim() : "";
      const err = checkTemplate(b.event, title, body);
      if (err) throw new MoneyError(err);
      const waTemplate = typeof b.waTemplate === "string" && b.waTemplate.trim() ? b.waTemplate.trim().slice(0, 100) : null;
      if (waTemplate && !/^[a-z0-9_]+$/.test(waTemplate)) throw new MoneyError("WhatsApp template names use small letters, digits and _ only");
      const dltId = typeof b.dltId === "string" && b.dltId.trim() ? b.dltId.trim().slice(0, 40) : null;
      if (dltId && !/^\d{10,25}$/.test(dltId)) throw new MoneyError("DLT template id is 10 to 25 digits");
      const data = { title, body, waTemplate, dltId };
      return ctx.tx.messageTemplate.upsert({
        where: { tenantId_event_lang: { tenantId: ctx.tenantId, event: b.event, lang: b.lang } },
        create: { event: b.event, lang: b.lang, ...data },
        update: data,
      });
    },
    { entity: "MessageTemplate" }
  );
}

/** Body: { event, lang } → back to the built-in wording. */
export async function DELETE(req: Request) {
  return engageWrite(
    req,
    "template.reset",
    "messages.manage",
    async (ctx, b) => {
      if (!isEventKey(b.event) || (b.lang !== "en" && b.lang !== "hi")) throw new MoneyError("Pick the message and language");
      const r = await ctx.tx.messageTemplate.deleteMany({ where: { event: b.event, lang: b.lang } });
      return { count: r.count };
    },
    { entity: "MessageTemplate" }
  );
}
