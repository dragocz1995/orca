'use client';
import { useState } from 'react';
import { pluginIcon } from './pluginMeta';

/** A plugin's brand icon rendered as a `size`×`size` box. When the plugin ships an `icon.svg` (served by
 *  the daemon icon route) it's drawn edge-to-edge as an `<img>` — the SVG carries its own rounded-square
 *  brand background. Otherwise (no icon, or the image failed) it falls back to the plugin's lucide glyph
 *  centered in a neutral rounded box, so every plugin still reads as an icon. */
export function PluginIcon({ name, hasIcon, size = 24 }: { name: string; hasIcon?: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.23);
  if (hasIcon && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/plugins/${encodeURIComponent(name)}/icon`}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: radius }}
        onError={() => setFailed(true)}
      />
    );
  }
  const Icon = pluginIcon(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center border border-border bg-elevated text-text-muted"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Icon size={Math.round(size * 0.46)} aria-hidden />
    </span>
  );
}
