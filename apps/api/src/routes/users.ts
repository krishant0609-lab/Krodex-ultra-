/**
 * KRODEX API — /users routes.
 *
 *   POST   /users              — Create a public.users row from an
 *                                authenticated JWT.
 *   GET    /users/me           — Read the caller's own row.
 *   GET    /users/me/profile   — Read the caller's profile.
 *   PATCH  /users/me           — Update display_name / timezone / locale.
 *   PATCH  /users/me/profile   — Upsert the caller's profile.
 *
 * The dev token mint route lives in /auth/dev-token and is mounted
 * separately.
 */

import type { FastifyInstance } from 'fastify';
import type { UserRow, ProfileRow, Json } from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody } from '../validation/parse';
import {
  CreateUserBody,
  UpdateProfileBody,
  UpdateUserBody,
} from '../validation/schemas';
import * as users from '../services/users';

export function registerUserRoutes(app: FastifyInstance): void {
  /**
   * Self-service: a freshly minted JWT has no public.users row yet.
   * The user calls this once to materialize the row keyed to the
   * JWT subject. The auth_user_id comes from the verified token,
   * not from the request body — so callers cannot claim someone
   * else's user.
   */
  app.post('/users', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(CreateUserBody, req.body);
    // The body says auth_user_id but the auth layer is the source
    // of truth. Override before persisting.
    const created = await users.createUser(req.supabaseUser, {
      auth_user_id: auth.userId,
      email: body.email,
      display_name: body.display_name,
      timezone: body.timezone ?? 'UTC',
      locale: body.locale ?? 'en-US',
    });
    return ok<UserRow>(reply, created, 201);
  });

  app.get('/users/me', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const me = await users.getUserById(req.supabaseUser, auth.userId);
    return ok<UserRow>(reply, me);
  });

  app.patch('/users/me', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(UpdateUserBody, req.body);
    const updated = await users.updateUser(req.supabaseUser, auth.userId, {
      ...(body.display_name !== undefined ? { display_name: body.display_name } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
    });
    return ok<UserRow>(reply, updated);
  });

  app.get('/users/me/profile', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const profile = await users.getProfile(req.supabaseUser, auth.userId);
    return ok<ProfileRow>(reply, profile);
  });

  app.patch('/users/me/profile', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(UpdateProfileBody, req.body);
    const profile = await users.updateProfile(req.supabaseUser, auth.userId, {
      ...(body.grade !== undefined ? { grade: body.grade } : {}),
      ...(body.board !== undefined ? { board: body.board } : {}),
      ...(body.exam_target !== undefined ? { exam_target: body.exam_target } : {}),
      ...(body.study_goal !== undefined ? { study_goal: body.study_goal } : {}),
      ...(body.preferred_subject_ids !== undefined
        ? { preferred_subject_ids: body.preferred_subject_ids }
        : {}),
      ...(body.settings !== undefined ? { settings: body.settings as Json } : {}),
    });
    return ok<ProfileRow>(reply, profile);
  });
}
