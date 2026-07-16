import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from '../components/ui/Skeleton';

describe('Skeleton', () => {
  it('renders an aria-hidden shimmer block', () => {
    render(<Skeleton />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('skeleton');
  });

  it('passes size and shape through via className', () => {
    render(<Skeleton className="h-24 w-full rounded-2xl" />);
    expect(screen.getByTestId('skeleton').className).toContain('h-24');
  });
});
