/**
 * KRODEX — handler registry.
 *
 * Per PHASE3_PLAN.md §6.1, every event_outbox row fans out to one
 * handler per subscription. The registry is the single source of
 * truth for "given an event_type, which handlers should run".
 *
 * Why a registry (and not hardcoded switch):
 *   - It keeps the worker loop generic: it never names a handler.
 *   - Tests can register a tiny fake handler without touching
 *     production code.
 *   - New handlers can be added by appending one line in
 *     server.ts without re-releasing the worker.
 *
 * Subscription shape:
 *   A handler subscribes to a specific event_type. The worker
 *   delivers one envelope per (event_id, handler_name) pair. A
 *   handler is responsible for being a no-op on event_types it
 *   does not recognize; the worker does not pre-filter.
 *
 * The synthetic `system.tick` event is delivered to every handler
 * that subscribes to it explicitly. We do not auto-subscribe to
 * `system.tick`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { EventEnvelope, EventType } from '@krodex/shared';

import type { HandlerOutcome } from './handler-outcome';

/**
 * A handler is the small function the worker calls once per
 * (event_id, handler_name) delivery. It must:
 *   - be idempotent (the worker may call it again after a transient
 *     failure)
 *   - never emit outbox events on its own (use the explicit
 *     `*_derived` event helpers instead, which compute the
 *     appropriate worker idempotency key)
 *   - never throw for a logical "I have no work for this event"
 *     (return { kind: 'succeeded', wrote: 0, skipped: ... } instead)
 *   - throw only for unexpected / retryable errors
 */
export interface Handler {
  /** Stable, unique name. Used as `event_log.handler_name`. */
  readonly name: string;
  /** Run the handler. Throws on retryable failure. */
  handle(client: SupabaseClient, envelope: EventEnvelope): Promise<HandlerOutcome>;
}

export type HandlerRegistry = {
  /** Register a handler. The handler is its own source-of-truth for `name`. */
  register(handler: Handler): void;
  /** Subscribe `handler` to one or more event types. */
  subscribe(handler: Handler, ...eventTypes: readonly EventType[]): void;
  /** Return every handler subscribed to `eventType`. */
  handlersFor(eventType: EventType): readonly Handler[];
  /** Return every registered handler (for health/observability). */
  allHandlers(): readonly Handler[];
};

/**
 * Create a fresh registry. The returned object is mutable; tests
 * create their own. Production code creates one at boot and passes
 * it into the worker.
 */
export function createRegistry(): HandlerRegistry {
  const handlers = new Map<string, Handler>();
  // Map<eventType, Set<handlerName>>. We store names (not handler
  // refs) so `register` can replace the handler impl without leaving
  // stale references in the subscription set.
  const subs = new Map<EventType, Set<string>>();

  const ensure = (t: EventType): Set<string> => {
    let s = subs.get(t);
    if (!s) {
      s = new Set();
      subs.set(t, s);
    }
    return s;
  };

  return {
    register(handler) {
      handlers.set(handler.name, handler);
    },
    subscribe(handler, ...eventTypes) {
      handlers.set(handler.name, handler);
      for (const t of eventTypes) ensure(t).add(handler.name);
    },
    handlersFor(eventType) {
      const names = subs.get(eventType);
      if (!names) return [];
      const out: Handler[] = [];
      for (const n of names) {
        const h = handlers.get(n);
        if (h) out.push(h);
      }
      return out;
    },
    allHandlers() {
      return Array.from(handlers.values());
    },
  };
}
