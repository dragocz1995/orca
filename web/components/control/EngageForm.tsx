'use client';
import { useState } from 'react';
import { Button } from '../ui/Button';
export function EngageForm({ onEngage }: { onEngage: (v: { epicId: string; autonomy: string; maxSessions: number; clearedGuardrails: string[] }) => void }) {
  const [epicId, setEpicId] = useState('');
  const [autonomy, setAutonomy] = useState('L3');
  const [maxSessions, setMaxSessions] = useState(1);
  return (
    <form
      className="flex flex-wrap items-center gap-2 p-3"
      onSubmit={(e) => { e.preventDefault(); if (epicId.trim()) onEngage({ epicId: epicId.trim(), autonomy, maxSessions, clearedGuardrails: [] }); }}
    >
      <input value={epicId} onChange={(e) => setEpicId(e.target.value)} placeholder="Epic ID" className="bg-surface border border-border rounded-none px-2 py-1 text-sm text-text" />
      <select value={autonomy} onChange={(e) => setAutonomy(e.target.value)} className="bg-surface border border-border rounded-none px-2 py-1 text-xs text-text">
        {['L0', 'L1', 'L2', 'L3'].map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <input type="number" min={1} value={maxSessions} onChange={(e) => setMaxSessions(Number(e.target.value))} className="w-16 bg-surface border border-border rounded-none px-2 py-1 text-xs text-text" />
      <Button type="submit" variant="accent">Engage</Button>
    </form>
  );
}
