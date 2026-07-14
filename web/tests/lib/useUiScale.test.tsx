import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UiScaleProvider, useUiScale, autoScaleFor } from '../../lib/useUiScale';

function Probe() {
  const { scale, preference, setPreference } = useUiScale();
  return <button onClick={() => setPreference(1.2)}>applied:{scale} pref:{preference}</button>;
}

/** The automatic base reads `window.innerWidth`, so every test pins it — jsdom's default (1024) would
 *  otherwise silently park the app at the floor of the ramp and make these numbers look arbitrary. */
function widen(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}
const resizeTo = (width: number) => act(() => { widen(width); window.dispatchEvent(new Event('resize')); });

// jsdom doesn't store the non-standard `zoom` property, so assert the applier *call* instead.
let setSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  widen(1920); // a full-width desktop window: the automatic base stays neutral unless a test says otherwise
  setSpy = vi.spyOn(document.documentElement.style, 'setProperty');
});
afterEach(() => setSpy.mockRestore());

describe('autoScaleFor — the window-width base', () => {
  it('renders at reference density once the window is as wide as the design was drawn for', () => {
    expect(autoScaleFor(1900)).toBe(1);
  });

  it('never inflates a window wider than the reference — the design has a natural size', () => {
    expect(autoScaleFor(2560)).toBe(1);
    expect(autoScaleFor(3840)).toBe(1);
  });

  // The whole complaint: half a big monitor is still a wide window in CSS px, so a ramp that only bit
  // below 1600 left the app at full size exactly where it felt oversized.
  it('shrinks in proportion to the width, so half a large monitor is visibly scaled down', () => {
    expect(autoScaleFor(1600)).toBe(0.85);
    expect(autoScaleFor(1440)).toBe(0.75);
  });

  it('bottoms out rather than shrinking into unreadability on a narrow window', () => {
    expect(autoScaleFor(1280)).toBe(0.7);
    expect(autoScaleFor(480)).toBe(0.7);
  });

  it('quantises to 5% notches, so dragging a window edge steps rather than reflowing on every pixel', () => {
    for (let w = 1000; w <= 2000; w += 7) expect((autoScaleFor(w) * 100) % 5).toBe(0);
  });

  it('falls back to neutral when there is no measurable window (SSR)', () => {
    expect(autoScaleFor(0)).toBe(1);
  });
});

describe('useUiScale', () => {
  it('defaults to a neutral preference and applies the zoom to the document root', () => {
    render(<UiScaleProvider><Probe /></UiScaleProvider>);
    expect(screen.getByText('applied:1 pref:1')).toBeTruthy();
    expect(setSpy).toHaveBeenCalledWith('zoom', '1');
  });

  it('setPreference updates state, zoom, the --ui-scale var and localStorage', () => {
    render(<UiScaleProvider><Probe /></UiScaleProvider>);
    fireEvent.click(screen.getByText('applied:1 pref:1'));
    expect(screen.getByText('applied:1.2 pref:1.2')).toBeTruthy();
    expect(setSpy).toHaveBeenCalledWith('zoom', '1.2');
    expect(setSpy).toHaveBeenCalledWith('--ui-scale', '1.2'); // full-height layout divides by this
    expect(localStorage.getItem('elowen:ui-scale')).toBe('1.2');
  });

  it('hydrates a persisted preference on mount', () => {
    localStorage.setItem('elowen:ui-scale', '1.35');
    render(<UiScaleProvider><Probe /></UiScaleProvider>);
    expect(screen.getByText('applied:1.35 pref:1.35')).toBeTruthy();
    expect(setSpy).toHaveBeenCalledWith('zoom', '1.35');
  });

  it('clamps an out-of-range preference to the allowed bounds', () => {
    function Clamp() {
      const { preference, setPreference } = useUiScale();
      return <button onClick={() => setPreference(9)}>v:{preference}</button>;
    }
    render(<UiScaleProvider><Clamp /></UiScaleProvider>);
    fireEvent.click(screen.getByText('v:1'));
    expect(screen.getByText('v:1.5')).toBeTruthy(); // MAX_SCALE
  });

  // The whole point of the feature: half-screening the app shrinks it without anyone touching a slider.
  it('re-scales live when the window is resized, leaving the preference untouched', () => {
    render(<UiScaleProvider><Probe /></UiScaleProvider>);
    expect(screen.getByText('applied:1 pref:1')).toBeTruthy();
    resizeTo(1600);
    expect(screen.getByText('applied:0.85 pref:1')).toBeTruthy();
    expect(setSpy).toHaveBeenCalledWith('zoom', '0.85');
  });

  // The two factors compose: the window says "this is narrow", the user says "I like it big".
  it('multiplies the personal preference by the automatic base', () => {
    render(<UiScaleProvider><Probe /></UiScaleProvider>);
    resizeTo(1280);                                         // base 0.7
    fireEvent.click(screen.getByText('applied:0.7 pref:1')); // preference 1.2
    expect(screen.getByText('applied:0.84 pref:1.2')).toBeTruthy(); // and NOT 0.8399999999999999
    expect(setSpy).toHaveBeenCalledWith('zoom', '0.84');
  });

  it('stops listening to resizes once unmounted', () => {
    const { unmount } = render(<UiScaleProvider><Probe /></UiScaleProvider>);
    const remove = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    remove.mockRestore();
  });
});
