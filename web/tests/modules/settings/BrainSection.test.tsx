import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../../components/ui/Toast';
import { createWrapper } from '../../test-utils';
import { en } from '../../../lib/i18n/dictionaries/en';

const saveProviders = vi.fn();
const disconnect = vi.fn();
const updateConfig = vi.fn(() => Promise.resolve());
const CONFIG = { brain: { providers: [], agentName: 'Elowen', maxSteps: 20 } };
// The daemon's /brain/oauth/status returns the full supported type set (OAUTH_BUILTIN); the rendered
// account rows are derived from these keys, so the mock mirrors the endpoint faithfully.
const OAUTH = { 'oauth-anthropic': true, 'oauth-openai-codex': false, 'oauth-github-copilot': false, 'oauth-kimi': false };

vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConfig: () => ({ data: CONFIG }),
  useBrainOauthStatus: () => ({ data: OAUTH, refetch: vi.fn() }),
}));
vi.mock('../../../lib/mutations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpdateConfig: () => ({ mutate: vi.fn(), mutateAsync: updateConfig }),
  useSaveBrainProviders: () => ({ mutate: saveProviders }),
  useBrainOauthDisconnect: () => ({ mutate: disconnect }),
}));
vi.mock('../../../lib/elowenClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    elowenClient: { ...(actual.elowenClient as object), brainOauthCatalog: vi.fn(() => Promise.resolve({ models: ['claude-opus', 'claude-sonnet'] })) },
  };
});

import { BrainSection } from '../../../modules/settings/BrainSection';

const renderSection = () => render(<ToastProvider><BrainSection /></ToastProvider>, { wrapper: createWrapper().wrapper });

beforeEach(() => { saveProviders.mockClear(); disconnect.mockClear(); updateConfig.mockClear(); });

describe('BrainSection — OAuth account model picker', () => {
  it('provides shared settings groups for the page-owned settings document', () => {
    const { container } = renderSection();

    expect(container.querySelector('[data-settings-document]')).toBeNull();
    expect(container.querySelectorAll('[data-settings-group]')).toHaveLength(3);
    // One row per OAuth account type (Claude, ChatGPT, Copilot, Kimi) plus the provider entries.
    expect(container.querySelectorAll('.settings-row')).toHaveLength(7);
    expect(container.querySelector('.spatial-group')).toBeNull();
    expect(container.querySelector('.border-y.divide-y')).toBeNull();
  });

  it('opens the manage modal for a connected account, picks a model (icon rows), and saves the selection', async () => {
    renderSection();
    // The connected Claude account exposes a "Models" button opening the manage-selection modal.
    fireEvent.click(screen.getByRole('button', { name: `${en.brain.pickModels}: ${en.brain.types['oauth-anthropic']}` }));
    // Catalog loads async → rows render with per-model brand icons.
    const row = await screen.findByRole('button', { name: 'claude-opus' });
    expect(row.querySelector('img')).toBeTruthy();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: en.managePicker.saveChanges }));

    await waitFor(() => expect(saveProviders).toHaveBeenCalled());
    const payload = saveProviders.mock.calls.at(-1)![0] as { id: string; models: string[] }[];
    const entry = payload.find((p) => p.id === 'anthropic');
    expect(entry?.models).toEqual(['claude-opus']);
  });

  it('confirms before disconnecting an OAuth account', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: `${en.brain.disconnect}: ${en.brain.types['oauth-anthropic']}` }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.getByText(en.brain.disconnectConfirm.replace('{provider}', en.brain.types['oauth-anthropic']))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.brain.disconnect }));
    expect(disconnect).toHaveBeenCalledWith('oauth-anthropic', expect.any(Object));
  });
});
