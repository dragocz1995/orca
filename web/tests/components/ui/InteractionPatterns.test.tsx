import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntityList, EntityRow } from '../../../components/ui/EntityList';
import { DataTable, DataTableCell, DataTableRow } from '../../../components/ui/DataTable';
import { MotionLayout, MotionLayoutItem } from '../../../components/ui/Motion';
import { createWrapper } from '../../test-utils';

describe('interaction patterns', () => {
  it('provides one semantic entity-register contract', () => {
    render(<EntityList aria-label="Projects"><EntityRow selected>Elowen</EntityRow></EntityList>);
    expect(screen.getByRole('list', { name: 'Projects' })).toHaveClass('border', 'rounded-lg');
    expect(screen.getByRole('listitem')).toHaveAttribute('data-state', 'selected');
    expect(screen.getByRole('listitem')).toHaveClass('px-4');
  });

  it('provides a responsive table composition contract', () => {
    render(
      <DataTable ariaLabel="Usage" columns="1fr 8rem">
        <DataTableRow header><DataTableCell header>Model</DataTableCell><DataTableCell header priority="wide">Tokens</DataTableCell></DataTableRow>
      </DataTable>,
    );
    expect(screen.getByRole('table', { name: 'Usage' })).toHaveStyle({ '--data-table-columns': '1fr 8rem' });
    expect(screen.getByRole('table', { name: 'Usage' })).toHaveClass('border', 'rounded-lg');
    expect(screen.getByRole('row')).toHaveClass('px-4');
    expect(screen.getByRole('columnheader', { name: 'Tokens' })).toHaveAttribute('data-priority', 'wide');
  });

  it('keeps layout-animated content mounted', () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><MotionLayout><MotionLayoutItem layoutId="alpha">Alpha</MotionLayoutItem></MotionLayout></Wrapper>);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
});
