-- =============================================================
-- KRODEX — migration 01: required Postgres extensions
-- Phase 1 (Core Data Model + Persistence)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- These extensions are part of the documented Supabase surface and
-- must be enabled before any domain schema is created.

create extension if not exists "uuid-ossp"   with schema extensions;
create extension if not exists "pgcrypto"    with schema extensions;
create extension if not exists "citext"      with schema extensions; -- case-insensitive emails / usernames
create extension if not exists "pg_trgm"     with schema extensions; -- fuzzy search (syllabus / questions later)
