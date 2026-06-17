import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExecutorPicker } from '../../../components/control/ExecutorPicker';
import { CreateTaskForm } from '../../../components/control/CreateTaskForm';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('control inputs', () => {
  it('ExecutorPicker fires onPick with the exec value', () => {
    const onPick = vi.fn();
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><ExecutorPicker onPick={onPick} /></QueryClientProvider>);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ollama/deepseek-v4-flash' } });
    expect(onPick).toHaveBeenCalledWith('ollama/deepseek-v4-flash');
  });
  it('CreateTaskForm fires onCreate with the title', () => {
    const onCreate = vi.fn();
    render(<CreateTaskForm onCreate={onCreate} />);
    fireEvent.change(screen.getByPlaceholderText('New task title'), { target: { value: 'Build X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalledWith({ title: 'Build X' });
  });
});

const cfgServer = setupServer(http.get('*/config', () => HttpResponse.json({ allowedExecs: ['sonnet'], autopilot: { model: 'm', apiUrl: 'u', apiKeySet: false } })));

describe('ExecutorPicker allowlist', () => {
  beforeAll(() => cfgServer.listen()); afterAll(() => cfgServer.close());
  it('shows only allowed presets', async () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><ExecutorPicker onPick={() => {}} /></QueryClientProvider>);
    await waitFor(() => {
      const opts = Array.from(document.querySelectorAll('option')).map((o) => o.getAttribute('value')).filter(Boolean);
      expect(opts).toEqual(['sonnet']); // only the allowed one
    });
  });
});
