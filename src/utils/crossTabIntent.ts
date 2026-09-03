/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Intent handed from one top-level tab to another across a navigation.
 *
 * The app renders exactly one tab at a time, so a `window` event carrying a
 * payload from the outgoing tab to the incoming one cannot work: the sender
 * dispatches while the receiver is still unmounted, the receiver registers its
 * listener on mount, and the payload has already been fired into an empty room.
 * That is precisely how the Metrics "resolve gap" action became a silent no-op —
 * it navigated to the review queue and opened nothing.
 *
 * A slot the sender fills and the receiver drains on mount has no such ordering
 * requirement. `take` clears as it reads, so a stale intent cannot re-trigger on
 * a later visit to the same tab.
 *
 * The existing `navigate_tab` event is still the right tool for navigation
 * itself: it carries only a destination, and App is mounted the whole time.
 */

export interface ResolveGapIntent {
  gapId: string;
  queryText: string;
}

let pendingResolveGap: ResolveGapIntent | null = null;

export function setPendingResolveGap(intent: ResolveGapIntent): void {
  pendingResolveGap = intent;
}

/** Reads and clears. A second call returns null. */
export function takePendingResolveGap(): ResolveGapIntent | null {
  const intent = pendingResolveGap;
  pendingResolveGap = null;
  return intent;
}
