import type { ReactNode } from 'react';

/** A two-column page body: the main content plus an optional right rail. On narrow widths the rail stacks
 *  ABOVE the content; from `@3xl` it moves to a fixed-width right column. Without a rail the content is
 *  simply full-width. Container-query driven, so it responds to the panel it sits in, not the viewport. */
export function PageLayout({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  if (!rail) return <div className="flex min-w-0 flex-col gap-6">{children}</div>;
  return (
    <div className="@container">
      <div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
        <div className="flex shrink-0 flex-col gap-4 @3xl:order-2 @3xl:w-72">{rail}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-6 @3xl:order-1">{children}</div>
      </div>
    </div>
  );
}
