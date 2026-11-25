"use client";

import { useEffect } from "react";

/**
 * Keyboard help for the office tables (no state, DOM only): "/" jumps to the
 * page's search box, "j" and "k" move a highlight down and up the rows of the
 * first data table, Enter opens the highlighted row's first link.
 */
export default function TableKeys() {
  useEffect(() => {
    let at = -1;
    const rows = () => [...document.querySelectorAll<HTMLTableRowElement>("table.dt tbody tr")].filter((r) => r.offsetParent !== null);
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
    };
    const mark = (list: HTMLTableRowElement[]) => {
      list.forEach((r, i) => r.toggleAttribute("data-focus", i === at));
      list[at]?.scrollIntoView({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "/") {
        const box = document.querySelector<HTMLInputElement>("main input[type=search], main input[placeholder*=earch]");
        if (box) {
          e.preventDefault();
          box.focus();
        }
        return;
      }
      const list = rows();
      if (!list.length) return;
      if (e.key === "j" || e.key === "k") {
        at = Math.max(0, Math.min(list.length - 1, at + (e.key === "j" ? 1 : -1)));
        mark(list);
      } else if (e.key === "Enter" && at >= 0) {
        list[at]?.querySelector<HTMLAnchorElement>("a[href]")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
