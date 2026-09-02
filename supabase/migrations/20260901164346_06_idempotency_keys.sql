-- =============================================================
-- KRODEX — migration 06: idempotency keys
-- Phase 2 (Domain Services + API Contracts)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- Idempotency-Key header (TRD §5.7) lets a client safely retry a
-- mutating request without producing duplicate side effects. The
-- server stores the (user_id, key, route) tuple and the canonical
-- response that was returned the first time. A retry with the same
-- tuple returns the stored response.
--
-- Storage layout:
--   * keyed by (user_id, route, idempotency_key) — all three are
--     required. A key for one user MUST NOT collide with another.
--   * request_hash is sha256(canonical-json(body)) so that a client
--     cannot accidentally reuse a key with a different payload.
--   * response_status + response_body is what we return on replay.
--   * expires_at allows the row to be vacuumed after 24h (the
--     documented replay window; see TRD §5.7).
-- =============================================================

set search_path = public, extensions;

create table if not exists public.idempotency_keys (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  route             text not null,                      -- e.g. "POST /v1/test-attempts/:id/submit"
  idempotency_key   text not null,
  request_hash      text not null,                      -- sha256 hex
  response_status   int  not null,                      -- 2xx status returned the first time
  response_body     jsonb not null,                     -- canonical response payload
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  unique (user_id, route, idempotency_key)
);

create index if not exists idx_idempotency_keys_user_id    on public.idempotency_keys(user_id);
create index if not exists idx_idempotency_keys_expires_at on public.idempotency_keys(expires_at);

drop trigger if exists trg_idempotency_keys_user_id_immutable on public.idempotency_keys;
create trigger trg_idempotency_keys_user_id_immutable before update on public.idempotency_keys
  for each row execute function public.prevent_user_id_mutation();

comment on table public.idempotency_keys is
  'Idempotency-Key replay store. Keyed by (user_id, route, idempotency_key). Replays within 24h return the original response. A retry with a different request_hash is rejected (the client must use a fresh key).';
