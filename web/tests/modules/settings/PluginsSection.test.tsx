import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { en } from '../../../lib/i18n/dictionaries/en';
import type { PluginInfo } from '../../../lib/types';

const usePlugins = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/queries', () => ({ usePlugins }));
vi.mock('../../../lib/mutations', () => ({ useTogglePlugin: () => ({ mutate, isPending: false }) }));
vi.mock('../../../components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { PluginsSection } from '../../../modules/settings/PluginsSection';

const plugin = (over: Partial<PluginInfo>): PluginInfo => ({
  name: 'files', version: '1.0.0', description: 'File tools', provides: { tools: ['read'] },
  source: 'bundled', enabled: true, configurable: false, ...over,
});

const renderSection = () => render(<LanguageProvider><PluginsSection /></LanguageProvider>);

describe('PluginsSection catalog', () => {
  beforeEach(() => { usePlugins.mockReset(); mutate.mockReset(); });

  it('renders a card per plugin with the category filter', () => {
    usePlugins.mockReturnValue({ data: [plugin({ name: 'files' }), plugin({ name: 'discord', provides: { platforms: ['discord'] } })], isLoading: false });
    renderSection();
    expect(screen.getByText('files')).toBeInTheDocument();
    expect(screen.getByText('discord')).toBeInTheDocument();
    // "All" plus a Platforms pill (discord declares a platform) show up in the filter.
    expect(screen.getByRole('radio', { name: en.plugins.catAll })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: en.plugins.catPlatforms })).toBeInTheDocument();
  });

  it('filters the grid by the search query and shows the no-matches empty state', () => {
    usePlugins.mockReturnValue({ data: [plugin({ name: 'files' }), plugin({ name: 'discord', provides: { platforms: ['discord'] } })], isLoading: false });
    renderSection();
    fireEvent.change(screen.getByPlaceholderText(en.plugins.searchPlaceholder), { target: { value: 'disc' } });
    expect(screen.queryByText('files')).not.toBeInTheDocument();
    expect(screen.getByText('discord')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(en.plugins.searchPlaceholder), { target: { value: 'zzz' } });
    expect(screen.getByText(en.plugins.noMatches)).toBeInTheDocument();
  });

  it('surfaces the error health badge for an unhealthy plugin', () => {
    usePlugins.mockReturnValue({ data: [plugin({ name: 'web', health: 'error' })], isLoading: false });
    renderSection();
    expect(screen.getByText(en.plugins.healthError)).toBeInTheDocument();
  });
});
