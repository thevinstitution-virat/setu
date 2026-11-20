"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { fileUrl, useFetch } from "@/components/admin/AdminKit";

type Announcement = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  imageKey: string | null;
  pinned: boolean;
  startsAt: string;
  endsAt: string | null;
};

/** Home page cards: announcements live for me now, pinned first. Nothing shows when there are none. */
export default function AnnouncementCards() {
  const { data } = useFetch<{ items: Announcement[] }>("/api/announcements");
  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <section className="space-y-3" aria-label="Announcements">
      {items.map((a) => (
        <article key={a.id} className={`card overflow-hidden ${a.pinned ? "border-2 !border-[var(--genda)]" : ""}`}>
          {a.imageKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(a.imageKey)} alt="" className="w-full max-h-56 object-cover bg-ink/5" loading="lazy" />
          )}
          <div className="p-4 space-y-2">
            <div className="flex items-start gap-3">
              <span className="icon-tile !h-10 !w-10 shrink-0 bg-[var(--genda-tint)] text-[var(--genda-text)]">
                <Icon name="megaphone" className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                {a.pinned && <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--genda-text)]">Pinned</p>}
                <h2 className="font-bold text-base break-words">{a.title}</h2>
                <p className="text-sm text-[var(--ink-2)] mt-1 whitespace-pre-line break-words">{a.body}</p>
              </div>
            </div>
            {a.link && a.link.startsWith("/") && (
              <div className="flex justify-end">
                <Link href={a.link} className="btn btn-kesar btn-sm">
                  Open <Icon name="arrow" className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
