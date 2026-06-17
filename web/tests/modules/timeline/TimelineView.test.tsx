import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { TimelineView } from '../../../modules/timeline/TimelineView';
import { createWrapper } from '../../test-utils';

const server = setupServer(http.get('*/activity', () => HttpResponse.json([
  { id: 3, ts: '2026-06-17 12:50:00', type: 'task', target: 'orca-x', detail: 'closed' },
  { id: 2, ts: '2026-06-17 12:10:00', type: 'mission', target: 'm1', detail: 'active' },
])));
beforeAll(() => server.listen()); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('TimelineView', () => {
  it('renders the activity feed rows', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><TimelineView /></Wrapper>);
    expect(await screen.findByText('orca-x')).toBeTruthy();
    expect(screen.getByText('m1')).toBeTruthy();
  });
});
