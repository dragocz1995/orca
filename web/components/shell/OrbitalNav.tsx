'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useHealth } from '../../lib/queries';
import { useTranslation } from '../../lib/i18n';
import { entryIsActive } from './NavGroup';
import { useShellNavigation } from './useShellNavigation';
import type { NavEntry } from './NavItem';

function wrapsDelta(index: number, focus: number, count: number): number {
  let delta = index - focus;
  if (delta > count / 2) delta -= count;
  if (delta < -count / 2) delta += count;
  return delta;
}

/** Desktop future navigation: an accessible DOM orbit over a WebGL ambient scene. */
export function OrbitalNav({ compact = false, side = 'left' }: { compact?: boolean; side?: 'left' | 'right' }) {
  const pathname = usePathname();
  const { worlds, systemItems } = useShellNavigation();
  const health = useHealth();
  const { t } = useTranslation();
  const entries = useMemo<NavEntry[]>(() => [
    ...worlds.flatMap((world) => world.id === 'work' || world.id === 'projects'
      ? (world.subItems ?? []).map((item) => ({ ...item, icon: item.icon ?? world.icon }))
      : [world]),
    ...systemItems.flatMap((group) => group.subItems?.length
      ? group.subItems.map((item) => ({ ...item, icon: item.icon ?? group.icon }))
      : [group]),
  ], [worlds, systemItems]);
  const routeIndex = Math.max(0, entries.findIndex((entry) => entryIsActive(entry, pathname)));
  const [focusIndex, setFocusIndex] = useState(routeIndex);
  const [suppressedIndex, setSuppressedIndex] = useState<number | null>(null);
  const wheelAt = useRef(Number.NEGATIVE_INFINITY);
  const wheelDelta = useRef(0);
  const wheelReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionReset = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setFocusIndex(routeIndex), [routeIndex]);
  useEffect(() => () => {
    if (wheelReset.current) clearTimeout(wheelReset.current);
    if (motionReset.current) clearTimeout(motionReset.current);
  }, []);
  const move = (step: number) => {
    const next = (focusIndex + step + entries.length) % entries.length;
    const wrapIndex = entries.findIndex((_, index) => Math.abs(
      wrapsDelta(index, next, entries.length) - wrapsDelta(index, focusIndex, entries.length),
    ) > 1);
    setSuppressedIndex(wrapIndex >= 0 ? wrapIndex : null);
    if (motionReset.current) clearTimeout(motionReset.current);
    motionReset.current = setTimeout(() => setSuppressedIndex(null), 620);
    setFocusIndex(next);
  };
  const onWheel = (event: React.WheelEvent) => {
    if (Math.abs(event.deltaY) < 0.5) return;
    event.preventDefault();
    wheelDelta.current += event.deltaY;
    if (wheelReset.current) clearTimeout(wheelReset.current);
    wheelReset.current = setTimeout(() => { wheelDelta.current = 0; }, 160);
    const now = performance.now();
    if (now - wheelAt.current < 220 || Math.abs(wheelDelta.current) < 32) return;
    wheelAt.current = now;
    move(wheelDelta.current > 0 ? 1 : -1);
    wheelDelta.current = 0;
  };

  const centerX = compact ? 30 : 50;
  const radiusX = compact ? 46 : 100;
  const verticalStep = compact ? 52 : 62;
  const mirrored = side === 'right';

  return (
    <nav
      data-testid="future-navigation"
      aria-label={t.common.primaryNav}
      onWheel={onWheel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(mirrored ? 1 : -1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(mirrored ? -1 : 1); }
      }}
      className={`relative h-full shrink-0 overflow-visible ${compact ? 'w-36' : 'w-[23rem]'}`}
    >
      <div role="list" className="absolute inset-0 z-30">
        {entries.map((entry, index) => {
          const delta = wrapsDelta(index, focusIndex, entries.length);
          const distance = Math.abs(delta);
          const suppressed = suppressedIndex === index;
          const x = centerX + Math.cos(distance * 0.28) * radiusX;
          const y = delta * verticalStep;
          const focused = index === focusIndex;
          const active = entryIsActive(entry, pathname);
          const Icon = entry.icon;
          const position = mirrored ? { right: x } : { left: x };
          const control = `group flex items-center gap-3 whitespace-nowrap transition-[color,opacity,transform,filter] duration-300 ${focused ? 'text-accent' : active ? 'text-text' : 'text-text-muted/85 hover:text-text'} ${compact ? 'justify-center' : ''} ${mirrored ? 'flex-row-reverse text-right' : 'text-left'}`;
          const content = (
            <>
              <span className={`orbit-node ${focused ? 'orbit-node-active' : ''} grid shrink-0 place-items-center rounded-full border backdrop-blur-md transition-[width,height,border-color,background-color,box-shadow] ${focused ? 'h-14 w-14 border-accent/50 bg-accent/12 shadow-[0_0_38px_rgb(255_82_54_/_0.22)]' : 'h-11 w-11 border-border-strong/90 bg-black/65'}`}>
                <Icon size={focused ? 22 : 19} strokeWidth={1.5} aria-hidden />
              </span>
              {!compact ? <span className={`text-lg font-medium tracking-tight ${focused ? 'translate-x-0 opacity-100' : 'opacity-90'}`}>{entry.label}</span> : null}
            </>
          );
          return (
            <div
              key={entry.id ?? entry.label}
              role="listitem"
              className="absolute top-1/2 transition-[transform,opacity] duration-700 ease-[var(--ease-out)]"
              style={{ ...position, transform: `translateY(calc(-50% + ${y}px)) scale(${focused ? 1 : Math.max(0.82, 0.98 - distance * 0.03)})`, transformOrigin: mirrored ? 'right center' : 'left center', opacity: suppressed ? 0 : focused ? 1 : Math.max(0.62, 0.94 - distance * 0.05), zIndex: 20 - distance, pointerEvents: suppressed ? 'none' : undefined }}
            >
              {entry.href ? (
                <Link href={entry.href} tabIndex={suppressed ? -1 : undefined} aria-label={compact ? entry.label : undefined} aria-current={active ? 'page' : undefined} className={control}>
                  {content}
                </Link>
              ) : (
                <button type="button" tabIndex={suppressed ? -1 : undefined} aria-label={compact ? entry.label : undefined} className={control} onClick={() => setFocusIndex(index)}>
                  {content}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!compact ? (
        <div className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-text-muted/35">
          <button type="button" onClick={() => move(-1)} aria-label={t.calendar.previous}><ChevronLeft size={13} aria-hidden /></button>
          <span>{health.data?.version ? `v${health.data.version}` : '—'}</span>
          <button type="button" onClick={() => move(1)} aria-label={t.calendar.next}><ChevronRight size={13} aria-hidden /></button>
        </div>
      ) : null}
    </nav>
  );
}
