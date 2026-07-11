'use client';

import * as m from 'motion/react-m';
import { usePathname } from 'next/navigation';
import { useRef, type ReactNode } from 'react';
import { useEffects } from '../../lib/useEffects';

/**
 * Softly reveals one live route tree. We deliberately do not overlap whole pages: overlapping client
 * pages duplicates their data hooks and heavy scenes (Settings briefly created two WebGL mascots).
 * Starting above half opacity keeps the new route continuously visible without a black frame.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { resolvedMode } = useEffects();
  const disabled = resolvedMode === 'off';
  const reduced = resolvedMode === 'reduced';
  const routeSequence = useRef(0);
  const previousPathname = useRef(pathname);
  if (previousPathname.current !== pathname) {
    routeSequence.current += 1;
    previousPathname.current = pathname;
  }
  // The sequence matters when a user returns to the same route before its previous instance has
  // finished exiting (Stats → Settings → Stats). A pathname-only key would collide with that exiting
  // layer and Motion could leave the reused node at opacity 0.
  const routeKey = `${pathname}:${routeSequence.current}`;

  return (
    <m.div
      key={routeKey}
      data-testid="route-transition"
      className="h-full"
      initial={disabled ? false : { opacity: reduced ? 0.86 : 0.62 }}
      animate={{ opacity: 1 }}
      transition={disabled
        ? { duration: 0 }
        : reduced
          ? { duration: 0.14, ease: 'linear' }
          : { duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </m.div>
  );
}
