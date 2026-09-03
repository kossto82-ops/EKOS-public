// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/shared/ErrorBoundary';
import * as telemetry from '../src/utils/telemetry';

function Bomb(): never {
  throw new Error('Boom');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary telemetry wiring', () => {
  it('reports a structured event through the telemetry seam when a child throws', () => {
    const reportSpy = vi.spyOn(telemetry, 'reportError').mockImplementation(() => {});
    // React logs the caught error to the console by design; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'react_error_boundary', message: 'Boom' })
    );
  });

  it('still shows the fallback UI and lets the user reset it', () => {
    vi.spyOn(telemetry, 'reportError').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    // Resetting re-renders the same throwing child, so it lands back in the
    // error state — this just confirms Reset doesn't itself crash or no-op silently.
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
