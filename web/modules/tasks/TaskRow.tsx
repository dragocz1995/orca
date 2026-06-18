'use client';
import { useState } from 'react';
import { Pencil, Play, Archive, Trash2, Clock } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSpawn, useCloseTask, useDeleteTask } from '../../lib/mutations';
import { taskExec } from '../../lib/taskExec';
import { Badge } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/IconButton';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { taskTypeMeta } from './taskMeta';

function fmtSchedule(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function TaskRow({ task, onEdit, selected = false, onToggleSelect, selecting = false }: { task: Task; onEdit: (t: Task) => void; selected?: boolean; onToggleSelect?: (id: string) => void; selecting?: boolean }) {
  const spawn = useSpawn();
  const close = useCloseTask();
  const del = useDeleteTask();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta = taskTypeMeta(task.type);
  const Icon = meta.icon;
  const exec = taskExec(task.labels);
  const preview = task.description?.trim() || 'No details yet — click to add context for the agent.';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(task)}
      onKeyDown={(e) => { if (e.key === 'Enter') onEdit(task); }}
      className={`group -mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-3 transition-colors ${selected ? 'bg-accent/10' : 'hover:bg-elevated/50'}`}
    >
      {onToggleSelect ? (
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(task.id)}
          aria-label={`Select ${task.id}`}
          className={`mt-0.5 shrink-0 accent-accent transition-opacity ${selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        />
      ) : null}
      <Icon size={16} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{task.title}</span>
          <span className="shrink-0 font-mono text-[11px] text-text-muted">{task.id}</span>
        </div>
        <div className={`mt-0.5 truncate text-xs ${task.description?.trim() ? 'text-text-muted' : 'text-text-muted/60 italic'}`}>{preview}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {task.scheduled_at ? <Badge tone="muted"><Clock size={11} className="mr-1 inline" aria-hidden />{fmtSchedule(task.scheduled_at)}</Badge> : null}
        {exec ? <Badge>{exec}</Badge> : null}
        <Badge tone={task.status === 'in_progress' ? 'accent' : 'default'}>{task.status}</Badge>
        <div
          className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton icon={Pencil} label="Edit" onClick={() => onEdit(task)} />
          <IconButton icon={Play} label="Launch" onClick={() => spawn.mutate({ taskId: task.id, exec: exec || undefined }, { onSuccess: (r) => toast(`Launched ${r.session}`), onError: (e) => toast(String(e), 'error') })} />
          <ActionMenu
            label="Delete or close"
            items={[
              { label: 'Close (archive)', icon: Archive, onSelect: () => close.mutate(task.id, { onSuccess: () => toast(`Closed ${task.id}`), onError: (e) => toast(String(e), 'error') }) },
              { label: 'Delete permanently', icon: Trash2, tone: 'danger', onSelect: () => setConfirmDelete(true) },
            ]}
          />
        </div>
      </div>
      {confirmDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open={confirmDelete}
            title={`Delete ${task.id}?`}
            description="This permanently removes the task and its dependency links."
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => { setConfirmDelete(false); del.mutate(task.id, { onSuccess: () => toast(`Deleted ${task.id}`), onError: (e) => toast(String(e), 'error') }); }}
          />
        </div>
      )}
    </div>
  );
}
