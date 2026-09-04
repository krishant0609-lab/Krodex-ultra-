-- ============================================================================
-- KRODEX — Phase 15: Performance indexes (additive)
-- ============================================================================
--
-- Scope: Phase 15 hot query paths that the Phase 0–13 schema did not
-- cover with a covering index. Phase 0–13 already indexes every
-- per-user lookup that was in scope at the time. The two indexes
-- added here are for hot paths Phase 15 makes observable in
-- monitoring:
--
--   1. notification_deliveries (channel, created_at) WHERE state = 'pending'
--      The in-app delivery dispatcher reads
--        SELECT id FROM notification_deliveries
--         WHERE state = 'pending' AND channel = 'in_app'
--         ORDER BY created_at ASC LIMIT n
--      The existing idx_notification_deliveries_state covers the
--      state='pending' predicate but not the channel filter or the
--      ORDER BY, so the planner sorts the matching rows. The new
--      index lets the planner seek directly in dispatch order.
--
--   2. backlog_items (user_id, created_at) WHERE state = 'open'
--      The recovery-suggestions route reads
--        SELECT * FROM backlog_items
--         WHERE user_id = X AND state = 'open'
--         ORDER BY created_at ASC LIMIT n
--      The existing idx_backlog_items_state covers (user_id, state)
--      but not created_at. The new index lets the planner return
--      the oldest open items without a sort.
--
-- No data migration. No RLS changes. CONCURRENTLY is not used here
-- because the migration runs as a single transaction; on an
-- already-populated production table the DBA can apply these
-- manually with CONCURRENTLY during a quiet window.
--
-- These indexes are additive — existing query plans remain valid,
-- the planner may pick the new index when it is more selective.

create index if not exists idx_notification_deliveries_pending_channel_time
  on public.notification_deliveries (channel, created_at asc)
  where state = 'pending';

create index if not exists idx_backlog_items_user_open_time
  on public.backlog_items (user_id, created_at asc)
  where state = 'open';

comment on index public.idx_notification_deliveries_pending_channel_time is
  'Phase 15: covers the in-app delivery dispatcher hot path (state=pending, channel=in_app, ORDER BY created_at).';
comment on index public.idx_backlog_items_user_open_time is
  'Phase 15: covers the recovery-suggestions hot path (user_id + state=open, ORDER BY created_at).';
