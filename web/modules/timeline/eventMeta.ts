import { ListChecks, Rocket, Radio, ShieldCheck, Circle, type LucideIcon } from 'lucide-react';
import type { Tone } from '../../components/ui/tone';

export function eventIcon(type: string): LucideIcon {
  switch (type) {
    case 'task': return ListChecks;
    case 'mission': return Rocket;
    case 'signal': return Radio;
    case 'review': return ShieldCheck;
    default: return Circle;
  }
}
export function eventTone(type: string): Tone {
  switch (type) {
    case 'task': return 'accent';
    case 'mission': return 'accent';
    case 'signal': return 'muted';
    case 'review': return 'warning';
    default: return 'default';
  }
}
