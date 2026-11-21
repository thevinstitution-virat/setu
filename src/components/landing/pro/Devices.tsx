"use client";

import { Logo } from "@/components/BrandMark";
import { APP_NAME } from "@/lib/brand";

/**
 * Device frames for the landing page — a modern phone, a tablet and a laptop —
 * each with a real status bar and the VBiz Pro app bar, so every mock-up reads
 * as the actual app on an actual device. Screens are passed in as children;
 * tablet and laptop screens are drawn at desktop size and scaled down (.vp-fit).
 */

function StatusIcons() {
  return (
    <span className="vp-sicons" aria-hidden="true">
      <svg viewBox="0 0 18 12">
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
        <rect x="10" y="3" width="3" height="9" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" />
      </svg>
      <svg viewBox="0 0 16 12">
        <path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.4 6.8a6.6 6.6 0 0 1 9.2 0l-1.5 1.5a4.5 4.5 0 0 0-6.2 0zM1 4.4a10 10 0 0 1 14 0l-1.5 1.5a7.9 7.9 0 0 0-11 0z" />
      </svg>
      <svg viewBox="0 0 27 12">
        <rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" strokeOpacity=".45" />
        <rect x="2.3" y="2.3" width="15.5" height="7.4" rx="1.8" />
        <path d="M24.4 4v4a2 2 0 0 0 0-4z" opacity=".45" />
      </svg>
    </span>
  );
}

/** The app's own top bar: V mark, name, and a context line (the signed-in role). */
export function AppBar({ sub, dark }: { sub?: string; dark?: boolean }) {
  return (
    <div className={`vp-appbar ${dark ? "dark" : ""}`} aria-hidden="true">
      <span className="vp-appbar-mark">
        <Logo kind="mark" height={13} />
      </span>
      <span className="vp-appbar-t">
        <b>{APP_NAME}</b>
        {sub && <small>{sub}</small>}
      </span>
      <span className="vp-appbar-bell">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />
        </svg>
        <i />
      </span>
    </div>
  );
}

/**
 * A phone: metal edge, side buttons, dynamic island, status bar, the VBiz Pro
 * app bar (pass `bar={false}` when the screen draws its own header) and the
 * home indicator.
 */
export function Phone({ children, sub, bar = true, className }: { children: React.ReactNode; sub?: string; bar?: boolean; className?: string }) {
  return (
    <div className={`vp-phone ${className ?? ""}`}>
      <span className="vp-phone-key k1" aria-hidden="true" />
      <span className="vp-phone-key k2" aria-hidden="true" />
      <span className="vp-phone-key k3" aria-hidden="true" />
      <div className="vp-phone-bezel">
        <div className="vp-phone-scr">
          <div className="vp-sbar" aria-hidden="true">
            <b>9:41</b>
            <span className="vp-island" />
            <StatusIcons />
          </div>
          {bar && <AppBar sub={sub} />}
          <div className="vp-phone-body">{children}</div>
          <span className="vp-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/** A tablet held in landscape: even bezel, front camera, status bar. */
export function Tablet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`vp-tablet ${className ?? ""}`}>
      <span className="vp-tablet-cam" aria-hidden="true" />
      <div className="vp-tablet-scr">
        <div className="vp-sbar vp-sbar-wide" aria-hidden="true">
          <b>9:41</b>
          <StatusIcons />
        </div>
        <div className="vp-tablet-body">
          <div className="vp-fit">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** A laptop: lid with camera, screen with the browser bar, and the base. */
export function Laptop({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`vp-laptop ${className ?? ""}`}>
      <div className="vp-laptop-lid">
        <span className="vp-laptop-cam" aria-hidden="true" />
        <div className="vp-laptop-scr">
          <div className="vp-browser-bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span className="vp-url">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              {APP_NAME}
            </span>
          </div>
          <div className="vp-laptop-body">
            <div className="vp-fit">{children}</div>
          </div>
        </div>
      </div>
      <div className="vp-laptop-base" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
