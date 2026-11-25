"use client";
/* eslint-disable @next/next/no-img-element -- files are pre-optimised WebP with a hand-written 1x/2x srcSet; the image optimiser would only re-encode them. */
import { useState } from "react";
import { ICON3D, type Icon3DName } from "@/lib/ui/icons3d";

type Motion = "bob" | "pop" | "tap" | "none";

export type Icon3DProps = {
  name: Icon3DName;
  /** Rendered box in CSS px. Use the sizes in ICONS_3D_GUIDE.md §4. */
  size?: number;
  /** Idle/entrance motion. "tap" lifts the icon when its nearest `.i3d-host` ancestor is pressed. */
  animate?: Motion;
  /** Paints a soft tile of the icon's own hue behind it (category tiles, rail). */
  tinted?: boolean;
  /** Set when the icon is the only label for its meaning. Leave empty when visible text sits next to it. */
  alt?: string;
  /** Above-the-fold icons (home category grid, success screen): load eagerly. */
  priority?: boolean;
  className?: string;
};

export function Icon3D({ name, size = 64, animate = "none", tinted = false, alt = "", priority = false, className = "" }: Icon3DProps) {
  const [loaded, setLoaded] = useState(false);
  const meta = ICON3D[name] ?? ICON3D["box-sealed"];
  const file = ICON3D[name] ? name : "box-sealed";
  const motion = animate === "none" ? "" : `i3d-${animate}`;

  return (
    <span
      className={`i3d ${tinted ? "i3d-tinted" : ""} ${className}`}
      style={{ width: size, height: size, ["--i3d-hue" as string]: meta.hue }}
      data-loaded={loaded || undefined}
    >
      <img
        src={`/icons3d/${file}.webp`}
        srcSet={`/icons3d/${file}.webp 1x, /icons3d/${file}-2x.webp 2x`}
        width={size}
        height={size}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={motion}
      />
    </span>
  );
}
