/**
 * KRODEX — handler outcome contract.
 *
 * Every worker handler returns a HandlerOutcome. The worker uses
 * the `kind` to decide what to write into event_log:
 *
 *   - 'succeeded'  : handler finished cleanly; worker writes a
 *                    succeeded row with attempt_count = 1 and
 *                    completed_at = now(). Subsequent deliveries
 *                    for the same (event_id, handler_name) are
 *                    no-ops because the unique index fires.
 *   - 'skipped'    : handler deliberately decided this event is
 *                    not interesting (e.g. event_type has no
 *                    projection for this handler). Worker writes
 *                    a succeeded row anyway — the unique index
 *                    prevents reprocessing, and we want a clear
 *                    audit trail that the handler ran.
 *   - 'failed'     : handler ran but encountered a recoverable
 *                    error. Worker should record the message and
 *                    consult the retry policy.
 *
 * Thrown exceptions (handler throws rather than returning) are
 * also mapped to 'failed' by the worker.
 */

export type HandlerOutcome =
  | { kind: 'succeeded'; wrote: number; skipped?: string }
  | { kind: 'failed'; message: string; retryable: boolean };
