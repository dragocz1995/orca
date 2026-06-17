'use client';
import { useState } from 'react';
import { Button } from '../ui/Button';
export function CreateTaskForm({ onCreate }: { onCreate: (v: { title: string }) => void }) {
  const [title, setTitle] = useState('');
  return (
    <form
      className="flex items-center gap-2 p-3"
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) { onCreate({ title: title.trim() }); setTitle(''); } }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task title"
        className="flex-1 bg-surface border border-border rounded-none px-2 py-1 text-sm text-text"
      />
      <Button type="submit" variant="accent">Create</Button>
    </form>
  );
}
