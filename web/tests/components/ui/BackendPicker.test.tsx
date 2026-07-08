import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { onUnhandledRequest } from '../../msw';
import { BackendPicker } from '../../../components/ui/BackendPicker';
import { createWrapper } from '../../test-utils';

// Worker presets fed to the picker + the Orca AI (brain) catalog served over the network. The
// allow-list gates which brain models appear — mirrors ExecutorPicker's `kind='all'` rule.
const MODELS = [
  { label: 'Claude Sonnet 4.5', exec: 'sonnet' },
  { label: 'GPT-5 Codex', exec: 'codex:gpt-5' },
];
const BRAIN = [
  { provider: 'anthropic', providerLabel: 'Anthropic', model: 'Claude Opus', exec: 'orca:anthropic::opus', source: 'oauth', contextWindow: 200000, contextWindowSet: false },
];

const server = setupServer(
  http.get('*/api/config', () => HttpResponse.json({ allowedExecs: ['sonnet', 'codex:gpt-5', 'orca:anthropic::opus'] })),
  http.get('*/api/brain/models', () => HttpResponse.json(BRAIN)),
);
beforeAll(() => server.listen({ onUnhandledRequest })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

/** Controlled harness so a pick updates `value` and we can inspect the `onChange` argument. */
function Harness({ onChange, initial = '', allowRelay = false }: { onChange: (v: string) => void; initial?: string; allowRelay?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <BackendPicker
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
      models={MODELS}
      relayLabel="Relay (model via API)"
      allowRelay={allowRelay}
    />
  );
}

function mount(props: Parameters<typeof Harness>[0]) {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><Harness {...props} /></Wrapper>);
}

describe('BackendPicker', () => {
  it('renders as a summary with a Manage button; empty value shows the relay label', async () => {
    mount({ onChange: vi.fn() });
    // No pill rows — just a compact summary + Manage affordance.
    expect(await screen.findByRole('button', { name: 'Manage' })).toBeTruthy();
    expect(screen.getByText('Relay (model via API)')).toBeTruthy();
  });

  it('opens the modal with worker + Orca AI groups, group logos and per-row icons', async () => {
    mount({ onChange: vi.fn() });
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));

    // Workers group: engine logo on the header, brand icon on the row.
    const workers = await screen.findByRole('heading', { name: 'Claude Code' });
    expect(workers.querySelector('img')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Claude Sonnet 4.5/ }).querySelector('img')).toBeTruthy();

    // Orca AI provider group: provider brand logo on the header, OAuth-badged row.
    const orca = await screen.findByRole('heading', { name: 'Anthropic' });
    expect(orca.querySelector('img')).toBeTruthy();
    expect(screen.getByText('OAuth')).toBeTruthy();
  });

  it('single-select: clicking a row and saving fires onChange with that exec', async () => {
    const onChange = vi.fn();
    mount({ onChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('button', { name: /GPT-5 Codex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('codex:gpt-5'));
  });

  it('single-select picks an Orca AI brain model by its exec', async () => {
    const onChange = vi.fn();
    mount({ onChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('button', { name: /Claude Opus/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('orca:anthropic::opus'));
  });

  it('when allowRelay, a pinned relay row lets the user clear the pick to relay', async () => {
    const onChange = vi.fn();
    mount({ onChange, initial: 'sonnet', allowRelay: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    // The pinned relay row (empty exec) sits above the groups; picking it saves ''.
    fireEvent.click(await screen.findByRole('button', { name: 'Relay (model via API)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });

  it('preserves a saved-but-unknown exec as a pinned, selectable row', async () => {
    const onChange = vi.fn();
    mount({ onChange, initial: 'removed:legacy-model' });
    // The summary surfaces the unknown value so it never silently vanishes.
    expect(await screen.findByText('removed:legacy-model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    // Re-picking it round-trips the same exec on save.
    fireEvent.click(await screen.findByRole('button', { name: /removed:legacy-model/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('removed:legacy-model'));
  });
});
