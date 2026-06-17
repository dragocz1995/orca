import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutorPicker } from '../../../components/control/ExecutorPicker';
import { CreateTaskForm } from '../../../components/control/CreateTaskForm';

describe('control inputs', () => {
  it('ExecutorPicker fires onPick with the exec value', () => {
    const onPick = vi.fn();
    render(<ExecutorPicker onPick={onPick} />);
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
