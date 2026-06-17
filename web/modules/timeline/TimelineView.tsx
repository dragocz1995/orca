'use client';
import { useState } from 'react';
import { useActivity } from '../../lib/queries';
import { bucketByHour } from './buckets';
import { eventIcon, eventTone } from './eventMeta';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import { Badge } from '../../components/ui/Badge';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/states';

const FILTER_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Tasks', value: 'task' },
  { label: 'Missions', value: 'mission' },
  { label: 'Signals', value: 'signal' },
];

export function TimelineView() {
  const [type, setType] = useState<string | undefined>(undefined);
  const q = useActivity(type);

  const data = bucketByHour(q.data ?? [], Date.now());
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.label}
            variant={type === opt.value ? 'accent' : 'default'}
            onClick={() => setType(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Activity bar graph */}
      <Section title="Activity / last 12h">
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-1 h-24">
            {data.map((d) => (
              <div
                key={d.label}
                className="flex-1 bg-accent"
                style={{ height: `${(d.count / max) * 100}%` }}
                title={`${d.label}: ${d.count}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {data.map((d) => (
              <div key={d.label} className="flex-1 text-center font-mono text-text-muted overflow-hidden" style={{ fontSize: 'var(--text-caption)' }}>
                {d.label}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Activity feed */}
      <Section title="Activity">
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState message="Failed to load activity" onRetry={() => q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {q.data.map((e) => {
              const Icon = eventIcon(e.type);
              const tone = eventTone(e.type);
              return (
                <div key={e.id} className="flex items-center gap-3 py-2">
                  <Icon className="shrink-0 text-text-muted" size={14} />
                  <span className="font-mono text-xs flex-1">{e.target}</span>
                  <Badge tone={tone}>{e.detail}</Badge>
                  <span className="text-text-muted text-xs whitespace-nowrap">{e.ts}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
