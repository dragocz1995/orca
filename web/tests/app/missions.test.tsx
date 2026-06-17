import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import MissionsPage from '../../app/missions/page';
import { ToastProvider } from '../../components/ui/Toast';
import { createWrapper } from '../test-utils';

let engageBody: any = null;
const server = setupServer(
  http.get('http://localhost:4400/missions', () => HttpResponse.json([])),
  http.post('http://localhost:4400/missions', async ({ request }) => { engageBody = await request.json(); return HttpResponse.json({ id: 'm1', state: 'active' }, { status: 201 }); }),
);
beforeAll(() => server.listen()); afterAll(() => server.close());

describe('MissionsPage', () => {
  it('engages a mission with the form values', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><MissionsPage /></ToastProvider></Wrapper>);
    fireEvent.change(screen.getByPlaceholderText('Epic ID'), { target: { value: 'orca-epic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Engage' }));
    await waitFor(() => expect(engageBody).toMatchObject({ epicId: 'orca-epic', autonomy: 'L3' }));
  });
});
