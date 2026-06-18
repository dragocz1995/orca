'use client';
import { useState } from 'react';
import { Rocket, Layers } from 'lucide-react';
import type { EngageInput } from '../../lib/types';
import { useTasks, useMissions, useConfig } from '../../lib/queries';
import { useEngage } from '../../lib/mutations';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Field } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Segmented';
import { EmptyState } from '../../components/ui/states';
import { useToast } from '../../components/ui/Toast';

const AUTONOMY: { value: string; label: string; desc: string }[] = [
  { value: 'L0', label: 'L0 · Recommend', desc: 'The Pilot only suggests. Nothing runs without you.' },
  { value: 'L1', label: 'L1 · Assist', desc: 'Runs clean, ready work; anything uncertain waits for you.' },
  { value: 'L2', label: 'L2 · Pilot', desc: 'Runs work and clears agent permission prompts itself; escalates only the ambiguous.' },
  { value: 'L3', label: 'L3 · Auto', desc: 'Full autonomy within guardrails — runs and self-clears, escalating only when it truly cannot judge.' },
];

export function EngageModal({ onClose }: { onClose: () => void }) {
  const tasks = useTasks();
  const missions = useMissions();
  const config = useConfig();
  const engage = useEngage();
  const { toast } = useToast();

  const activeEpics = new Set((missions.data ?? []).map((m) => m.epic_id));
  const epics = (tasks.data ?? []).filter((t) => t.type === 'epic' && !activeEpics.has(t.id));

  const [epicId, setEpicId] = useState('');
  const [autonomy, setAutonomy] = useState(config.data?.defaults?.autonomy ?? 'L3');
  const [maxSessions, setMaxSessions] = useState(config.data?.defaults?.maxSessions ?? 1);

  const submit = () => {
    if (!epicId) return;
    const input: EngageInput = { epicId, autonomy, maxSessions, clearedGuardrails: [] };
    engage.mutate(input, {
      onSuccess: () => { toast(`Engaged mission on ${epicId}`); onClose(); },
      onError: (e) => toast(String(e), 'error'),
    });
  };

  const autoDesc = AUTONOMY.find((a) => a.value === autonomy)?.desc;

  return (
    <Modal title="New mission" onClose={onClose} size="md">
      <div className="flex flex-col gap-5 p-5">
        {epics.length === 0 ? (
          <EmptyState title="No epics to engage" description="Create one with Autopilot · Planning on the Tasks page, then engage a mission here." />
        ) : (
          <>
            <Field label="Epic" hint="The Pilot drives this epic's phases to completion.">
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-surface p-1">
                {epics.map((e) => {
                  const active = e.id === epicId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEpicId(e.id)}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${active ? 'bg-accent/15 ring-1 ring-accent' : 'hover:bg-elevated'}`}
                    >
                      <Layers size={15} className={active ? 'text-accent' : 'text-text-muted'} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-text">{e.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">{e.id}</span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Autonomy">
              <Segmented value={autonomy} onChange={setAutonomy} options={AUTONOMY.map((a) => ({ value: a.value, label: a.label }))} />
            </Field>
            {autoDesc ? <p className="-mt-3 text-xs text-text-muted">{autoDesc}</p> : null}

            <Field label="Max concurrent sessions">
              <Input type="number" min={1} value={maxSessions} onChange={(e) => setMaxSessions(Number(e.target.value))} className="w-28" />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="accent" icon={Rocket} disabled={!epicId || engage.isPending} onClick={submit}>Engage</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
