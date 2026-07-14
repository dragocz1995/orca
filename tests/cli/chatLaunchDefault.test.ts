import { describe, it, expect, vi, beforeEach } from 'vitest';

const runChat = vi.fn(async () => {});
vi.mock('../../src/cli/chat/app.js', () => ({ runChat: (o: unknown) => runChat(o as never) }));
vi.mock('../../src/cli/chat/token.js', () => ({
  resolveToken: () => 'tok',
  login: async () => 'tok',
  NeedsLogin: class NeedsLogin extends Error {},
}));

const { launchChat } = await import('../../src/cli/chat/launch.js');

const env = {} as NodeJS.ProcessEnv;
const launched = async (opts?: { model?: string; session?: string; fresh?: boolean }) => {
  await launchChat('http://x', env, opts);
  return runChat.mock.calls.at(-1)![0] as unknown as { session?: string; fresh?: boolean };
};

// Opening the chat gives you a BLANK conversation, and that default lives in launchChat rather than in each
// caller for a reason: an omitted `fresh` used to mean "silently resume this directory's last conversation",
// which no caller wants — and the launcher menu, which passes no options at all, quietly got the old
// behaviour while `elowen chat` got the new one. Pinning the DEFAULT closes that whole class of bug,
// including for any entry point added later.
describe('launchChat — what an omitted flag means', () => {
  beforeEach(() => runChat.mockClear());

  it('opens a fresh conversation when the caller says nothing at all (the launcher menu)', async () => {
    expect(await launched()).toMatchObject({ fresh: true, session: undefined });
    expect(await launched({})).toMatchObject({ fresh: true });
    expect(await launched({ model: 'anthropic' })).toMatchObject({ fresh: true, model: 'anthropic' });
  });

  it('resuming is the deliberate act — an explicit fresh:false (the -c flag)', async () => {
    expect(await launched({ fresh: false })).toMatchObject({ fresh: false });
  });

  it('a named session resumes that conversation and is never overridden by the fresh default', async () => {
    expect(await launched({ session: 'brain-1-abc' })).toMatchObject({ fresh: false, session: 'brain-1-abc' });
  });

  it('an explicit fresh:true still wins over a session id, so --new means new', async () => {
    expect(await launched({ session: 'brain-1-abc', fresh: true })).toMatchObject({ fresh: true });
  });
});
