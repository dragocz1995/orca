import { describe, it, expect } from 'vitest';
import { reconcileMirrors, enqueueMirrored } from '../../src/brain/session/queueMirror.js';
import type { LiveBrain, QueuedMsg } from '../../src/brain/session/liveBrain.js';

describe('queueMirror.reconcileMirrors', () => {
  const img = [{ type: 'image' as const, data: 'B64', mimeType: 'image/png' }];

  it('drops delivered messages off the FRONT (PI delivers FIFO), keeping the survivors\' images', () => {
    const steer: QueuedMsg[] = [{ text: 'a', images: img }, { text: 'b' }, { text: 'c' }];
    const followUp: QueuedMsg[] = [];
    // PI delivered the two oldest steering messages → only 'c' remains in its (expanded) text queue.
    reconcileMirrors(steer, followUp, ['c-expanded'], []);
    expect(steer).toEqual([{ text: 'b' }, { text: 'c' }].slice(1)); // 'a','b' trimmed from the front → ['c']
    expect(steer.map((m) => m.text)).toEqual(['c']);
  });

  it('pads from PI text when something enqueued outside the mirror (those carry no images)', () => {
    const steer: QueuedMsg[] = [{ text: 'kept', images: img }];
    reconcileMirrors(steer, [], ['kept', 'bypass1', 'bypass2'], []);
    expect(steer).toHaveLength(3);
    expect(steer[0]).toEqual({ text: 'kept', images: img }); // image preserved
    expect(steer[1]).toEqual({ text: 'bypass1' });
    expect(steer[2]).toEqual({ text: 'bypass2' });
  });

  it('matched counts leave the image-carrying mirror untouched', () => {
    const steer: QueuedMsg[] = [{ text: 'x', images: img }];
    reconcileMirrors(steer, [], ['x-expanded-by-pi'], []); // same count → no shrink, no pad
    expect(steer).toEqual([{ text: 'x', images: img }]);
  });
});

describe('queueMirror.enqueueMirrored', () => {
  it('records the message (with images) on the mirror AND forwards to PI steer/followUp', async () => {
    const calls: { kind: string; text: string; images?: unknown }[] = [];
    const live = {
      session: {
        steer: async (text: string, images?: unknown) => { calls.push({ kind: 'steer', text, images }); },
        followUp: async (text: string, images?: unknown) => { calls.push({ kind: 'followUp', text, images }); },
      },
    } as unknown as LiveBrain;
    const img = [{ type: 'image' as const, data: 'Z', mimeType: 'image/png' }];
    await enqueueMirrored(live, 'steer', 'hi', img);
    await enqueueMirrored(live, 'followUp', 'later');
    expect(live.queuedSteer).toEqual([{ text: 'hi', images: img }]);
    expect(live.queuedFollowUp).toEqual([{ text: 'later', images: undefined }]);
    expect(calls).toEqual([
      { kind: 'steer', text: 'hi', images: img },
      { kind: 'followUp', text: 'later', images: undefined },
    ]);
  });
});
