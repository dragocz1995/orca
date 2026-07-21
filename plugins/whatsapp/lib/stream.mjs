// Streaming/edit-throttle machinery: the live progress message and the final-answer sending. The
// render/fold engine (result summaries, diff summaries, the same-failure fold rule, tool/card lines) is
// the SHARED transport-neutral core (../../_shared/liveTrace.mjs) — the exact one Discord and Telegram
// use — so WhatsApp no longer silently drops tool results, diffs, sub-agent panels or retry/compaction
// notices the way its old bespoke `toolLine` did. Only the transport (Baileys edit) stays local.
import { CHUNK, stripThinking, extractImageRefs, footerLine } from './format.mjs';
import { makeTextHelpers, outputFailed, makeOutputSummary, diffSummary, makeFoldedCalls, makeToolLinesFor, makeCardLines } from '../../_shared/liveTrace.mjs';
import { resolveDisplaySettings } from '../../_shared/display.mjs';

const EDIT_THROTTLE_MS = 1500; // WhatsApp is stricter than Discord on edits — stay well under any limit
/** How long a turn may go with no VISIBLE progress (a new tool call / card) before the `Step N / MAX`
 *  counter surfaces as a "still working" reassurance; any fresh tool/card resets the clock and drops it. */
const STALL_HINT_MS = 60_000;

// WhatsApp renders plain text (nothing to escape for mentions/fences), `*bold*` titles, no strikethrough on
// completed items, and an indented `↳` result line — the surface style the shared engine renders through.
const style = {
  mentionSafe: (s) => s,
  fenceSafe: (s) => s,
  bold: (s) => `*${s}*`,
  strike: (s) => s,
  summaryLine: (s) => `  ↳ ${s}`,
};
const { compactLine, safeTail } = makeTextHelpers(style);
const outputSummary = makeOutputSummary({ compactLine, safeTail });
const foldedCalls = makeFoldedCalls(compactLine);
const toolLinesFor = makeToolLinesFor({ compactLine, safeTail, style });
const cardLines = makeCardLines(style);

/** One editable WhatsApp message: created on the first write, then edited in place (throttled). Shared
 *  by the tool-progress bubble and — indirectly — the streaming answer. */
class EditableMessage {
  constructor(adapter, jid) {
    this.a = adapter;
    this.jid = jid;
    this.key = null;
    this.content = '';
    this.lastEdit = 0;
    this.pending = false;
  }
  update(content) { this.content = content.slice(0, CHUNK); void this.flush(); }
  async flush() {
    if (this.closed) return; // finalized elsewhere — a straggler edit must not overwrite the final text
    const now = Date.now();
    if (now - this.lastEdit < EDIT_THROTTLE_MS) { this.pending = true; return; }
    this.lastEdit = now;
    try {
      if (!this.key) {
        const s = await this.a.sock.sendMessage(this.jid, { text: this.content || '💭 …' });
        this.key = s?.key ?? null;
      } else {
        await this.a.sock.sendMessage(this.jid, { text: this.content, edit: this.key });
      }
    } catch { /* edit window closed / socket blip — the final message still goes out separately */ }
    if (this.pending) { this.pending = false; setTimeout(() => void this.flush(), EDIT_THROTTLE_MS); }
  }
}

/** Streaming turn: tool calls go into ONE edited progress message (one emoji-tagged line per tool,
 *  consecutive repeats collapsed to ×N), and the final answer is sent as its own clean message AFTER
 *  the run settles, quoted to the trigger. Mirrors the Discord adapter's LiveMessage. */
export class LiveMessage {
  constructor(adapter, jid, quoted, askerJid) {
    this.a = adapter;
    this.jid = jid;
    this.quoted = quoted;     // the triggering message — the final answer quotes it
    this.askerJid = askerJid; // who to route an AskUserQuestion prompt to (and gate its answer on)
    this.display = resolveDisplaySettings(adapter.cfg); // status activity + summary output + single message
    this.toolCalls = []; // lifecycle rows in display order
    this.toolById = new Map(); // PI toolCallId → row (parallel-safe completion/progress updates)
    this.notices = new Map(); // retry/compaction status lines by kind
    this.progress = null;
    this.text = '';
    this.imageRefs = [];
    this.idle = null;
    this.reasoning = '';
    this.cards = new Map();
    this.step = 0;
    this.maxSteps = 0;
    this.lastActivityAt = Date.now(); // last VISIBLE progress (tool/card) — the step counter only shows after a stall
    this.stallTimer = null;           // fires once STALL_HINT_MS after the last activity to surface the counter
  }
  renderProgress() {
    const toolLines = [];
    // The step counter is a STALL hint, not always-on: it surfaces only once the turn has gone
    // STALL_HINT_MS with no new tool/card, so a long step doesn't read as a frozen agent. Fresh
    // progress resets `lastActivityAt` and drops it again.
    if (this.maxSteps > 0 && Date.now() - this.lastActivityAt >= STALL_HINT_MS) {
      toolLines.push(`⚙️ Step ${Math.min(this.step, this.maxSteps)} / ${this.maxSteps}`);
    }
    // Fold consecutive same-tool calls (and same-signature failures) into one counted row, then render each
    // with its result summary / output tail — the shared rule Discord and Telegram use.
    for (const call of foldedCalls(this.toolCalls, this.display)) toolLines.push(...toolLinesFor(call, this.display));
    for (const notice of this.notices.values()) toolLines.push(`🔄 ${compactLine(notice, 240)}`);
    if (this.a.cfg?.showReasoning && this.reasoning.trim()) {
      const tail = this.reasoning.trim().slice(-280).replace(/\s+/g, ' ');
      toolLines.push(`💭 _${tail}_`);
    }
    const cards = [...this.cards.values()].map((c) => cardLines(c).join('\n')).filter(Boolean);
    const sections = [];
    if (toolLines.length) sections.push(toolLines.join('\n'));
    sections.push(...cards);
    if (!sections.length) return;
    this.progress ??= new EditableMessage(this.a, this.jid);
    this.progress.update(sections.join('\n┈┈┈┈┈┈┈┈┈┈\n'));
  }
  /** (Re)arm the stall hint: after STALL_HINT_MS of no visible tool progress, re-render so the step
   *  counter surfaces even during pure silence (one long-running tool emits no interim events). */
  armStallHint() {
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.renderProgress(), STALL_HINT_MS);
    if (typeof this.stallTimer.unref === 'function') this.stallTimer.unref();
  }
  findTool(id) {
    return id ? this.toolById.get(id) : this.toolCalls[this.toolCalls.length - 1];
  }
  /** Settle a tool row (its output/diff/end/image arrived): stamp state + result summary + output tail,
   *  reset the stall clock, and re-render. No-op when the row is gone (a reconnect dropped it). */
  settleTool(id, state = 'done', summary = '', tail = '') {
    const call = this.findTool(id);
    if (!call) return;
    call.state = state;
    call.progress = '';
    if (summary) call.summary = summary;
    if (tail) call.finalTail = tail;
    this.lastActivityAt = Date.now();
    this.armStallHint();
    this.renderProgress();
  }
  onEvent(e) {
    if (e.type === 'tool' && e.name) {
      if (this.display.toolActivity === 'off') return;
      const existing = e.id ? this.toolById.get(e.id) : null;
      let call;
      if (existing) {
        call = existing;
        call.detail = e.detail ?? call.detail;
        call.icon = e.icon ?? call.icon;
        call.state = 'running';
      } else {
        call = { id: e.id, name: e.name, detail: e.detail, icon: e.icon, state: 'running', progress: '', summary: '', finalTail: '' };
        this.toolCalls.push(call);
        if (e.id) this.toolById.set(e.id, call);
      }
      this.lastActivityAt = Date.now(); // visible progress → reset the stall clock, hide the step counter
      this.armStallHint();
      this.renderProgress();
    } else if (e.type === 'tool_progress' && e.id) {
      const call = this.findTool(e.id);
      if (call && this.display.toolActivity === 'live') {
        call.progress = safeTail(e.text);
        this.lastActivityAt = Date.now();
        this.armStallHint();
        this.renderProgress();
      }
    } else if (e.type === 'tool_output') {
      const output = e.output ?? {};
      this.settleTool(e.id, outputFailed(output) ? 'error' : 'done', outputSummary(output), output.fullText ?? output.text);
    } else if (e.type === 'diff') {
      const note = outputSummary(e.output);
      this.settleTool(e.id, outputFailed(e.output) ? 'error' : 'done', note || diffSummary(e.diff), e.diff);
    } else if (e.type === 'tool_end') {
      this.settleTool(e.id, e.isError ? 'error' : 'done');
    } else if (e.type === 'subagent' && e.id) {
      const call = this.findTool(e.id);
      if (call) {
        call.detail = e.detail || e.task || call.detail;
        call.summary = `${e.tools ?? 0} tools · ${e.seconds ?? 0}s`;
        if (e.status !== 'running') call.state = e.status === 'error' ? 'error' : 'done';
        this.lastActivityAt = Date.now(); this.armStallHint(); this.renderProgress();
      }
    } else if (e.type === 'notice' && e.kind) {
      // Notices annotate an existing trace; they never create a standalone bubble that would go stale as
      // soon as the transient notice clears.
      if (!this.progress && this.toolCalls.length === 0 && this.cards.size === 0) return;
      if (e.done) this.notices.delete(e.kind);
      else if (e.message) this.notices.set(e.kind, e.message);
      this.renderProgress();
    } else if (e.type === 'reasoning' && e.delta) {
      this.reasoning += e.delta;
      if (this.a.cfg?.showReasoning) this.renderProgress();
    } else if (e.type === 'text' && e.delta) {
      this.text += e.delta;
    } else if (e.type === 'image' && e.ref) {
      this.imageRefs.push(e.ref);
      this.settleTool(e.id, 'done', 'image ready');
    } else if (e.type === 'card' && e.card?.id) {
      const empty = (!e.card.items || e.card.items.length === 0) && !e.card.body;
      if (empty) this.cards.delete(e.card.id); else this.cards.set(e.card.id, e.card);
      this.lastActivityAt = Date.now(); // a card update is visible progress → reset the stall clock
      this.armStallHint();
      this.renderProgress();
    } else if (e.type === 'step' && e.maxSteps) {
      this.step = e.step; this.maxSteps = e.maxSteps;
      this.renderProgress();
    } else if (e.type === 'ask' && Array.isArray(e.questions)) {
      void this.a.postAsk(this.jid, this.quoted, this.askerJid, e.id, e.questions).catch(() => {});
    } else if (e.type === 'idle') {
      this.idle = e;
    }
  }
  /** Freeze the live bubble on a FAILED turn: clear the stall-hint timer and close the progress message
   *  so a straggler "⚙️ Step N" edit can't land after the ❌ + ⚠️ error reply already went out. */
  abandon() {
    clearTimeout(this.stallTimer);
    if (this.progress) this.progress.closed = true;
  }
  async finalize(reply) {
    clearTimeout(this.stallTimer);
    for (const call of this.toolCalls) if (call.state === 'running') call.state = 'done';
    this.notices.clear();
    if (this.progress) {
      this.lastActivityAt = Date.now(); // drop the stall step-counter from the settled tool trace
      this.renderProgress();
      this.progress.lastEdit = 0; // bypass the throttle for the final settle
      await this.progress.flush();
      this.progress.closed = true;
    }
    // Nothing happened here (mid-run steer into another turn) — don't post a placeholder.
    if (!reply && !this.text && !this.progress && !this.imageRefs.length) return;
    const full = stripThinking(reply || this.text || '(no response)');
    const { cleaned, files } = extractImageRefs(full);
    const names = new Set(files);
    for (const ref of this.imageRefs) names.add(ref.slice(ref.lastIndexOf('/') + 1));
    const data = names.size ? this.a.resolveImageFiles([...names]) : [];
    // Generated images go out FIRST as their own image messages (dead /brain/images links are stripped).
    if (data.length) await this.a.sendImages(this.jid, data, this.quoted).catch(() => {});
    const footer = this.a.cfg?.runtimeFooter !== false ? footerLine(this.idle) : '';
    const bodyText = cleaned.trim() ? cleaned : (data.length ? '' : full);
    const body = bodyText ? (footer ? `${bodyText}\n\n${footer}` : bodyText) : '';
    if (body) await this.a.sendText(this.jid, body, data.length ? undefined : this.quoted).catch(() => {});
  }
}
