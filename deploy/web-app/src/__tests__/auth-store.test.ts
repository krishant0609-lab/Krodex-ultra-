/**
 * KRODEX web — auth store tests.
 *
 * Verifies the in-memory token store: set, get, clear, isAuthenticated.
 * Per TRD §6, the dev-token path uses a memory-only store to avoid
 * the XSS surface of localStorage.
 */

import { describe, expect, it } from 'vitest';
import {
  clearAuth,
  getEmail,
  getExpiresAt,
  getToken,
  getUserId,
  isAuthenticated,
  setAuth,
} from '../lib/auth-store';

describe('auth-store', () => {
  it('starts unauthenticated', () => {
    clearAuth();
    expect(isAuthenticated()).toBe(false);
    expect(getToken()).toBeNull();
    expect(getUserId()).toBeNull();
    expect(getEmail()).toBeNull();
    expect(getExpiresAt()).toBeNull();
  });

  it('setAuth stores token, userId, optional email, optional expiry', () => {
    setAuth({
      token: 'tok-123',
      userId: 'user-abc',
      email: 'user@example.com',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(isAuthenticated()).toBe(true);
    expect(getToken()).toBe('tok-123');
    expect(getUserId()).toBe('user-abc');
    expect(getEmail()).toBe('user@example.com');
    expect(getExpiresAt()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('setAuth without email/expiresAt defaults to null', () => {
    setAuth({ token: 't2', userId: 'u2' });
    expect(getEmail()).toBeNull();
    expect(getExpiresAt()).toBeNull();
  });

  it('clearAuth wipes all fields', () => {
    setAuth({ token: 't3', userId: 'u3' });
    clearAuth();
    expect(isAuthenticated()).toBe(false);
    expect(getToken()).toBeNull();
    expect(getUserId()).toBeNull();
  });
});
