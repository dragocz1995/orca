import { describe, it, expect, vi } from 'vitest';
import { ConversationTitler } from '../../src/brain/conversationTitler.js';

function titlerWith(reply: string | Error | null) {
  const setTitle = vi.fn();
  const inference = reply === null
    ? () => null
    : () => ({ model: 'cheap', decide: vi.fn(async () => { if (reply instanceof Error) throw reply; return { text: reply }; }) });
  const titler = new ConversationTitler({ store: { setTitle } as never, inference: inference as never });
  return { titler, setTitle };
}

describe('ConversationTitler — names a new conversation from its first message', () => {
  it('sets a sanitized title (drops "Title:", wrapping quotes, trailing dot, extra lines)', async () => {
    const { titler, setTitle } = titlerWith('Title: "Brake pads for a Cadillac".\nsome rambling');
    await titler.run('sess-1', 'what are these brake pads for?');
    expect(setTitle).toHaveBeenCalledWith('sess-1', 'Brake pads for a Cadillac');
  });

  it('keeps a non-latin (e.g. Czech) title as-is', async () => {
    const { titler, setTitle } = titlerWith('Brzdové destičky Bosch');
    await titler.run('sess-2', 'na co jsou tyhle brzdové destičky?');
    expect(setTitle).toHaveBeenCalledWith('sess-2', 'Brzdové destičky Bosch');
  });

  it('no-ops when no titling model is configured (provisional title stays)', async () => {
    const { titler, setTitle } = titlerWith(null);
    await titler.run('sess-3', 'hello');
    expect(setTitle).not.toHaveBeenCalled();
    expect(titler.configured()).toBe(false);
  });

  it('no-ops on an empty first message', async () => {
    const { titler, setTitle } = titlerWith('Whatever');
    await titler.run('sess-4', '   ');
    expect(setTitle).not.toHaveBeenCalled();
  });

  it('swallows a relay error (best-effort, never throws into the turn)', async () => {
    const { titler, setTitle } = titlerWith(new Error('relay down'));
    await expect(titler.run('sess-5', 'hi there')).resolves.toBeUndefined();
    expect(setTitle).not.toHaveBeenCalled();
  });

  it('never sets an empty title when the model returns only decorations', async () => {
    const { titler, setTitle } = titlerWith('""');
    await titler.run('sess-6', 'hi');
    expect(setTitle).not.toHaveBeenCalled();
  });
});
