/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TelemetryEventType = 'react_error_boundary' | 'window_error' | 'unhandled_rejection';

export interface TelemetryEvent {
  type: TelemetryEventType;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Single seam for reporting client-side errors. Today this only emits a
 * structured console.error line — see the "Telemetry & Observability"
 * hardening item in docs/KNOWN_LIMITATIONS.md: there is no APM/OpenTelemetry
 * collector deployed to send this to yet, and wiring one up is Core
 * Engineering/DevOps-owned infrastructure work, not something this client
 * app can complete on its own.
 *
 * What this DOES provide: every error-capture call site (ErrorBoundary,
 * the global window handlers in main.tsx) reports through this one
 * function instead of ad-hoc console.error calls scattered across the
 * codebase, so connecting a real backend later is a one-line change here
 * rather than a hunt through every catch block.
 */
export function reportError(event: Omit<TelemetryEvent, 'timestamp'>): void {
  const fullEvent: TelemetryEvent = { ...event, timestamp: new Date().toISOString() };
  console.error('[telemetry]', JSON.stringify(fullEvent));
}
