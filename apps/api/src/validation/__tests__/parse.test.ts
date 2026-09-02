/**
 * KRODEX API — parseBody / parseQuery / parseParams.
 *
 * Each helper must wrap a zod failure in a `ValidationError`
 * carrying the field-level details, NOT a ZodError.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody, parseQuery, parseParams } from '../parse';
import { ValidationError } from '../../errors';

describe('parseBody', () => {
  it('returns the parsed value on success', () => {
    const schema = z.object({ a: z.number() });
    expect(parseBody(schema, { a: 1 })).toEqual({ a: 1 });
  });
  it('throws a ValidationError with field details on failure', () => {
    const schema = z.object({ a: z.number() });
    try {
      parseBody(schema, { a: 'oops' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const v = err as ValidationError;
      expect(v.code).toBe('VALIDATION_ERROR');
      expect(v.httpStatus).toBe(400);
      expect(v.fields?.[0]?.path).toBe('a');
    }
  });
});

describe('parseQuery', () => {
  it('defaults to {} when undefined is passed', () => {
    const schema = z.object({ a: z.number().optional() });
    expect(parseQuery(schema, undefined)).toEqual({});
  });
  it('reports validation errors', () => {
    const schema = z.object({ a: z.number() });
    expect(() => parseQuery(schema, { a: 'x' })).toThrow(ValidationError);
  });
});

describe('parseParams', () => {
  it('reports validation errors', () => {
    const schema = z.object({ id: z.string().uuid() });
    expect(() => parseParams(schema, { id: 'no' })).toThrow(ValidationError);
  });
  it('returns the parsed value on success', () => {
    const schema = z.object({ id: z.string().uuid() });
    expect(parseParams(schema, { id: '11111111-1111-4111-8111-111111111111' })).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
    });
  });
});
