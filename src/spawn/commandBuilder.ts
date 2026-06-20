export interface AgentSpec { program: string; model: string }
export interface SpawnCtx {
  projectPath: string;
  taskId: string;
  agentName: string;
  /** Task title + details, injected into the agent prompt so it knows what to do. */
  taskTitle?: string;
  taskDescription?: string;
  /** Shell command the agent runs to close its task when done. Defaults to `orca close <id>`. */
  closeCommand?: string;
  /** The parent epic's id, when this task is a mission phase. Lets the final-phase agent close the epic itself. */
  epicId?: string;
  /** Shell command the agent runs to close the parent epic (mirrors closeCommand but targets the epic). */
  epicCloseCommand?: string;
  /** Env vars exported before the agent starts (e.g. ORCA_URL/ORCA_TOKEN so the close command reaches the daemon). */
  env?: Record<string, string>;
  /** Override the provider binary (e.g. an absolute path); defaults to the program's conventional name. */
  bin?: string;
  /** Extra CLI args inserted after the model flag (configured per provider in Settings). */
  extraArgs?: string;
  /** When set, used verbatim as the agent prompt instead of the assembled worker preamble. Used by
   *  reasoning agents (Pilot/Overseer) that own their own instructions and close nothing. */
  rawPrompt?: string;
}

const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function buildAgentCommand(spec: AgentSpec, ctx: SpawnCtx): string {
  // A reasoning agent (Pilot/Overseer) carries its own complete prompt and never closes a task, so
  // it bypasses the worker preamble entirely. Returning early keeps that path obvious.
  if (ctx.rawPrompt !== undefined) {
    return buildLaunchCommand(spec, ctx, ctx.rawPrompt);
  }
  const closeCommand = ctx.closeCommand ?? `orca close ${ctx.taskId}`;
  const titlePart = ctx.taskTitle ? `: ${ctx.taskTitle}` : '';
  const detailsPart = ctx.taskDescription && ctx.taskDescription.trim() ? `\n\nDetails:\n${ctx.taskDescription.trim()}` : '';
  // A phase agent must NOT redo earlier phases. Without this it sees the whole goal in its details
  // and re-implements/re-verifies everything, only gradually discovering prior phases are done.
  const implementLines = ctx.epicId
    ? [
        `This is ONE phase of a larger sequential mission (epic ${ctx.epicId}) — NOT the whole goal. Earlier phases were already completed by other agents, so do NOT redo or re-verify their work.`,
        'Before you start, look at the current state of the repo (`git status`, `git diff`, and the files relevant to your phase) so you build on what is already there instead of starting over. Then skim the project context (AGENTS.md, CLAUDE.md, README) for conventions.',
        'Implement ONLY this phase\'s own deliverable, end to end — make the real code changes (don\'t just describe them) and verify just what you changed. Any "Overall goal" in the details above is shared mission context for reference; it is not your task.',
      ]
    : [
        'First read the project context (AGENTS.md, CLAUDE.md, or README) to understand conventions, then implement the task end to end. Make the actual code changes — do not just describe them. Verify your work (build/tests if relevant).',
      ];
  const lines = [
    `You are the orca agent "${ctx.agentName}". Work on task ${ctx.taskId}${titlePart}.${detailsPart}`,
    '',
    ...implementLines,
    `When you finish, close the task with a one-sentence summary of what you did and the result, plus the outcome:`,
    `  - success: ${closeCommand} --summary "<what you did + result>" --outcome ok`,
    `  - could not complete: ${closeCommand} --summary "<what blocked you>" --outcome fail`,
  ];
  if (ctx.epicId && ctx.epicCloseCommand) {
    // The agent owns mission completion: after closing its own phase, if it was the last
    // one, it closes the epic itself and writes the overall result summary.
    lines.push(
      '',
      `This task is a phase of epic ${ctx.epicId}. After you close your own task, run \`orca ls\` to check the epic's other phases. If every other phase of this epic is already closed (i.e. you were the final phase), close the epic yourself and write your own summary of the whole mission — what was done across all phases and anything still left to do:`,
      `  ${ctx.epicCloseCommand} --summary "<overall mission result: what happened + what's left>" --outcome ok`,
      `If any sibling phase is still open or in progress, do NOT touch the epic — that agent will handle it.`,
    );
  }
  return buildLaunchCommand(spec, ctx, lines.join('\n'));
}

/** Assemble the actual `cd && export … && <bin> … <prompt>` shell command for a given prompt. Shared
 *  by the worker path (assembled preamble) and the reasoning path (rawPrompt). */
function buildLaunchCommand(spec: AgentSpec, ctx: SpawnCtx, prompt: string): string {
  const cd = `cd ${esc(ctx.projectPath)}`;
  const envExport = ctx.env && Object.keys(ctx.env).length > 0
    ? Object.entries(ctx.env).map(([k, v]) => `export ${k}=${esc(v)}`).join(' && ') + ' && '
    : '';
  const extra = ctx.extraArgs && ctx.extraArgs.trim() ? ` ${ctx.extraArgs.trim()}` : '';
  if (spec.program.startsWith('opencode')) {
    const bin = ctx.bin || 'opencode';
    // Launch the interactive TUI (UI mode) with the task preloaded into the composer
    // via --prompt. The TUI holds the prompt but does not auto-submit it, so SpawnService
    // nudges Enter a few times once the UI has mounted (Enter on an empty composer is a
    // harmless no-op, so the extra presses are safe).
    return `${cd} && ${envExport}${bin} --model ${spec.model}${extra} --prompt ${esc(prompt)}`;
  }
  if (spec.program.startsWith('codex')) {
    const bin = ctx.bin || 'codex';
    // Positional prompt + autonomous approval bypass (codex's skip-permissions equivalent).
    return `${cd} && ${envExport}${bin} --dangerously-bypass-approvals-and-sandbox --model ${spec.model}${extra} ${esc(prompt)}`;
  }
  const bin = ctx.bin || 'claude';
  // Autonomous approval bypass: orca-spawned agents run unattended in a tmux pane, so an
  // interactive permission prompt would hang the whole mission. Mirror codex's bypass flag.
  return `${cd} && ${envExport}${bin} --dangerously-skip-permissions --model ${spec.model}${extra} ${esc(prompt)}`;
}
