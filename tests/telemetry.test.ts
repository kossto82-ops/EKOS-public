import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportError } from '../src/utils/telemetry';

/**
 * The telemetry seam (docs/KNOWN_LIMITATIONS.md's "Infrastructure
 * Observability" hardening item) is intentionally just a structured
 * console.error today — no APM/OpenTelemetry collector is deployed. This
 * test locks in the one thing that matters for a seam: every call produces
 * a single, parseable, structured event, so swapping the sink for a real
 * backend later doesn't require re-deriving the shape from console output.
 */
describe('reportError (src/utils/telemetry.ts)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a single structured event with the given fields plus a timestamp', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportError({ type: 'window_error', message: 'Something broke', stack: 'at foo.ts:1:1' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, payload] = spy.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed).toMatchObject({
      type: 'window_error',
      message: 'Something broke',
      stack: 'at foo.ts:1:1',
    });
    expect(typeof parsed.timestamp).toBe('string');
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();
  });

  it('preserves an optional context object', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportError({ type: 'react_error_boundary', message: 'render failed', context: { componentStack: 'in Foo' } });

    const [, payload] = spy.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed.context).toEqual({ componentStack: 'in Foo' });
  });
});
