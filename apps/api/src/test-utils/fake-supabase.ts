/**
 * KRODEX API — fake Supabase client for unit tests.
 *
 * The unit tests run with `LIVE_DB=0` (no live Supabase). They
 * still want to exercise the service layer (which calls .from(...)
 * chains) without making real network calls. This module returns a
 * minimal stub that supports the subset of the supabase-js
 * fluent API the services actually use.
 *
 * Supported operations:
 *  - from(table).select(...).eq().maybeSingle() / .single()
 *  - from(table).insert(row).select().single()
 *  - from(table).update(patch).eq().select().single()
 *  - from(table).upsert(row, { onConflict }).select().single()
 *  - from(table).select().order().limit() (returns an array)
 *  - from(table).select().order().eq().eq() etc.
 *  - rpc(name, params)
 *
 * Not supported: subscriptions, auth, storage, .range(), .or().
 * Add them as tests need them.
 */

import { expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError } from '../errors';

type Row = Record<string, unknown>;

/** Result of an awaited query. */
type Awaitable<T> = { data: T; error: null } | { data: null; error: { message: string; code?: string; details?: string; hint?: string } };

export interface FakeSupabaseOptions {
  /** Initial rows keyed by table name. */
  tables?: Record<string, Row[]>;
  /** Force every .from() to error with this message. */
  errorOn?: string;
  /** Default userId to attach to inserted rows when missing. */
  defaultUserId?: string;
  /**
   * Per-table unique constraints to model. Each entry is the set
   * of column names whose *combined* values must be unique. An
   * insert that collides on those columns returns a 23505
   * (unique_violation) error — matching the real Supabase/Postgres
   * behavior, so the outbox-writer's idempotency handling can be
   * tested without a live DB.
   */
  uniqueConstraints?: Record<string, readonly (readonly string[])[]>;
  /**
   * Per-RPC overrides. Keyed by RPC name. The function receives the
   * params the caller passed; return `{ data, error }` just like the
   * real client. Without an override, the default behavior is
   * `{ data: { rpc: name }, error: null }`. Use this to test
   * `claim_pending_events` and other RPCs without a live DB.
   */
  rpcImpls?: Record<
    string,
    (params: Record<string, unknown>) =>
      | { data: unknown; error: null }
      | { data: null; error: { code?: string; message: string } }
      | Promise<{ data: unknown; error: null } | { data: null; error: { code?: string; message: string } }>
  >;
}

export interface FakeSupabase {
  from: (table: string) => FakeQueryBuilder;
  rpc: (name: string, params: Record<string, unknown>) => Promise<Awaitable<unknown>>;
  __rows: (table: string) => Row[];
  __reset: () => void;
  __setError: (msg: string | null) => void;
  __defaultUserId: string | undefined;
  __errorOn: string | null;
  __uniqueConstraints: Record<string, readonly (readonly string[])[]>;
  __rpcImpls: Record<
    string,
    (params: Record<string, unknown>) =>
      | { data: unknown; error: null }
      | { data: null; error: { code?: string; message: string } }
      | Promise<{ data: unknown; error: null } | { data: null; error: { code?: string; message: string } }>
  >;
}

class FakeQueryBuilder {
  private readonly filters: Array<(row: Row) => boolean> = [];
  private readonly orderings: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  // `single` / `maybeSingle` are both methods on the real
  // supabase-js client, so we can't also have boolean fields of
  // the same name. We track the mode on private flags instead.
  private singleMode = false;
  private maybeSingleMode = false;
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private patch: Row = {};
  private insertRow: Row = {};
  private onConflict: string | null = null;

  constructor(
    private readonly table: string,
    private readonly client: FakeSupabase,
  ) {}

  /**
   * `.select()` after an insert/update/upsert just means "return the
   * affected rows" — it does NOT switch the operation. We only flip
   * to a fresh `select` when called on a brand-new chain.
   */
  select(_cols: string = '*'): this {
    if (this.op === 'select') return this;
    return this;
  }

  insert(row: Row): this {
    this.op = 'insert';
    this.insertRow = { ...row };
    return this;
  }

  update(patch: Row): this {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.insertRow = { ...row };
    this.onConflict = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== value);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push((r) => typeof r[column] === 'string' && (r[column] as string) > (value as string));
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push((r) => typeof r[column] === 'string' && (r[column] as string) < (value as string));
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push((r) => typeof r[column] === 'string' && (r[column] as string) <= (value as string));
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((r) => typeof r[column] === 'string' && (r[column] as string) >= (value as string));
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderings.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  /** `.single()` is the terminal that returns one row or an error. */
  single(): this {
    this.singleMode = true;
    return this;
  }

  /** `.maybeSingle()` returns one row or null (no error on miss). */
  maybeSingle(): this {
    this.maybeSingleMode = true;
    return this;
  }

  /** Terminal: await the chain. */
  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?:
      | ((value: Awaitable<unknown> | Awaitable<unknown[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.run();
    return Promise.resolve(result).then(onFulfilled as never, onRejected as never) as never;
  }

  /** Run the queued query and return the awaited result shape. */
  protected run(): Awaitable<unknown> | Awaitable<unknown[]> {
    if (this.client.__errorOn) {
      return { data: null, error: { message: this.client.__errorOn } };
    }

    const rows = this.client.__rows(this.table);

    if (this.op === 'insert') {
      const newRow = { ...this.insertRow };
      if (this.client.__defaultUserId && !newRow.user_id) newRow.user_id = this.client.__defaultUserId;
      if (!newRow.id) newRow.id = `id-${rows.length + 1}`;
      if (!newRow.created_at) newRow.created_at = new Date().toISOString();

      // Unique-constraint simulation. We model only the violation
      // path; the success path is unchanged.
      const tableUniques = this.client.__uniqueConstraints[this.table] ?? [];
      for (const cols of tableUniques) {
        const collision = rows.find((r) => cols.every((c) => r[c] === newRow[c]));
        if (collision) {
          return {
            data: null,
            error: {
              code: '23505',
              message: `duplicate key value violates unique constraint "${this.table}_${cols.join('_')}_key"`,
              details: `Key (${cols.join(', ')})=${cols.map((c) => newRow[c]).join(', ')} already exists.`,
              hint: '',
            },
          };
        }
      }

      rows.push(newRow);
      if (this.singleMode) return { data: newRow, error: null };
      return { data: newRow, error: null };
    }

    if (this.op === 'upsert') {
      const conflict = this.onConflict?.split(',') ?? ['id'];
      const existing = rows.find((r) => conflict.every((c) => r[c] === this.insertRow[c]));
      if (existing) {
        Object.assign(existing, this.insertRow);
        if (this.singleMode) return { data: existing, error: null };
        return { data: existing, error: null };
      }
      const newRow = { ...this.insertRow };
      if (this.client.__defaultUserId && !newRow.user_id) newRow.user_id = this.client.__defaultUserId;
      if (!newRow.id) newRow.id = `id-${rows.length + 1}`;
      rows.push(newRow);
      if (this.singleMode) return { data: newRow, error: null };
      return { data: newRow, error: null };
    }

    if (this.op === 'update') {
      const matched = rows.filter((r) => this.filters.every((f) => f(r)));
      // Replace each matched row with a fresh object so that any
      // previously-returned reference (e.g. a `before` snapshot read
      // by the service layer before this update) is NOT mutated in
      // place. The real Supabase client returns a fresh row, not a
      // reference to the server's internal copy.
      const matchedSet = new Set(matched);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r && matchedSet.has(r)) {
          rows[i] = { ...r, ...this.patch };
        }
      }
      const updatedRows = rows.filter((r) => this.filters.every((f) => f(r)));
      const first = updatedRows[0];
      if (this.singleMode) {
        if (!first) return { data: null, error: { message: 'no row returned' } };
        return { data: first, error: null };
      }
      return { data: updatedRows, error: null };
    }

    if (this.op === 'delete') {
      const matched = rows.filter((r) => this.filters.every((f) => f(r)));
      for (const r of matched) {
        const i = rows.indexOf(r);
        if (i >= 0) rows.splice(i, 1);
      }
      return { data: matched, error: null };
    }

    // select
    let matched = rows.filter((r) => this.filters.every((f) => f(r)));
    for (const o of this.orderings) {
      matched = [...matched].sort((a, b) => {
        const av = a[o.column];
        const bv = b[o.column];
        const cmp = (av as never) < (bv as never) ? -1 : (av as never) > (bv as never) ? 1 : 0;
        return o.ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);
    if (this.singleMode) {
      const first = matched[0];
      if (!first) return { data: null, error: { message: 'no row returned' } };
      return { data: first, error: null };
    }
    if (this.maybeSingleMode) {
      const first = matched[0];
      return { data: first ?? null, error: null };
    }
    return { data: matched, error: null };
  }
}

/**
 * Build a fake supabase-js client. Returned as a `SupabaseClient`
 * so it can be passed directly into the service layer. The real
 * service code is exercised; only the I/O is stubbed.
 */
export function makeFakeSupabase(
  opts: FakeSupabaseOptions = {},
): SupabaseClient {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(opts.tables ?? {})) {
    tables[k] = [...v];
  }
  const client: FakeSupabase = {
    from(table: string): FakeQueryBuilder {
      return new FakeQueryBuilder(table, client);
    },
    async rpc(name: string, params: Record<string, unknown>) {
      if (client.__errorOn) return { data: null, error: { message: client.__errorOn } };
      const impl = client.__rpcImpls[name];
      if (impl) return await impl(params);
      return { data: { rpc: name }, error: null };
    },
    __rows(table) {
      if (!tables[table]) tables[table] = [];
      return tables[table];
    },
    __reset() {
      for (const k of Object.keys(tables)) delete tables[k];
      client.__errorOn = opts.errorOn ?? null;
    },
    __setError(msg) {
      client.__errorOn = msg;
    },
    __defaultUserId: opts.defaultUserId,
    __errorOn: opts.errorOn ?? null,
    __uniqueConstraints: opts.uniqueConstraints ?? {},
    __rpcImpls: opts.rpcImpls ?? {},
  };

  // Cast: the real SupabaseClient carries a bag of fields and
  // methods the service layer never reads. We expose just the
  // surface they do read; tests reach the helpers via the
  // `__rows` / `__setError` / `__reset` extension points.
  return client as unknown as SupabaseClient;
}

/** Convenience: assert the service threw a typed error. */
export function expectThrows<E extends Error>(
  fn: () => unknown,
  Ctor: new (...a: never[]) => E,
  messagePart?: string,
): E {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(Ctor);
    if (messagePart) {
      expect((err as Error).message).toContain(messagePart);
    }
    return err as E;
  }
  throw new Error('expected throw, none happened');
}

// Re-export so tests can do `import { NotFoundError } from '../test-utils/fake-supabase';`
export { NotFoundError };
