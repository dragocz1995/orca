import {
  Puzzle, Globe, Database, FolderOpen, TerminalSquare, GraduationCap, Image as ImageIcon,
  Wand2, Clapperboard, Clock, Activity, ShieldCheck, MessageCircle, Mic, Bell, ListTodo,
  CircleHelp, Braces, Command, Paintbrush, PlugZap, FileCog, GitFork, MessagesSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Per-plugin visual identity: a recognizable icon instead of the one-size-fits-all puzzle piece.
 *  Names match plugin manifest names; unknown plugins fall back to the puzzle. */
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  files: FolderOpen,
  terminal: TerminalSquare,
  web: Globe,
  memory: Database,
  mem0: Database,
  todo: ListTodo,
  skills: GraduationCap,
  'image-gen': ImageIcon,
  'image-edit': Wand2,
  video: Clapperboard,
  cronjob: Clock,
  statusline: Activity,
  'security-scan': ShieldCheck,
  discord: MessageCircle,
  tts: Mic,
  notify: Bell,
  askuser: CircleHelp,
  codebase: Braces,
  'dev-commands': Command,
  formatters: Paintbrush,
  mcp: PlugZap,
  'runtime-context': FileCog,
  subagent: GitFork,
  whatsapp: MessagesSquare,
};

export function pluginIcon(name: string): LucideIcon {
  return PLUGIN_ICONS[name] ?? Puzzle;
}
