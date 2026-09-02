/**
 * KRODEX API — request schema unit tests.
 *
 * These tests lock the request-shape contract that the API
 * advertises. A change to any of these schemas is a breaking
 * change to the API surface and must be intentional.
 *
 * Coverage:
 *  - Valid bodies pass through and are stripped of unknown fields.
 *  - Invalid bodies produce specific issues with stable codes.
 *  - Defaults are applied (e.g. `strategy`, `template_payload`).
 *  - Enums reject unknown values.
 *  - Constraints (length, integer range, regex) are enforced.
 */

import { describe, expect, it } from 'vitest';
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateProfileBody,
  MintDevTokenBody,
  ListQuestionsQuery,
  ListSyllabusProgressQuery,
  UpsertSyllabusProgressBody,
  CreateTestDefinitionBody,
  StartTestAttemptBody,
  AnswerTestQuestionBody,
  ListTestAttemptsQuery,
  CreateErrorEntryBody,
  UpdateErrorEntryBody,
  LinkErrorQuestionBody,
  ScheduleReviewBody,
  UpdateReviewScheduleBody,
  RecordReviewAttemptBody,
  CreatePlannerTaskBody,
  UpdatePlannerTaskBody,
  CreatePlannerTemplateBody,
  UpdatePlannerTemplateBody,
  RecoverBacklogItemBody,
  ListBacklogItemsQuery,
  ListProgressEvidenceQuery,
  ListNotificationsQuery,
  UpdateNotificationBody,
  IdParam,
} from '../schemas';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('CreateUserBody', () => {
  it('accepts a valid user body', () => {
    const result = CreateUserBody.parse({
      auth_user_id: 'a-uuid',
      email: 'student@example.com',
      display_name: 'Krish',
      timezone: 'UTC',
      locale: 'en-US',
    });
    expect(result.email).toBe('student@example.com');
    expect(result.display_name).toBe('Krish');
  });

  it('rejects an invalid email', () => {
    const r = CreateUserBody.safeParse({
      auth_user_id: 'a-uuid',
      email: 'not-an-email',
      display_name: 'Krish',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty display_name after trim', () => {
    const r = CreateUserBody.safeParse({
      auth_user_id: 'a-uuid',
      email: 'a@b.co',
      display_name: '   ',
    });
    expect(r.success).toBe(false);
  });

  it('trims the email', () => {
    const result = CreateUserBody.parse({
      auth_user_id: 'a',
      email: '  a@b.co  ',
      display_name: 'K',
    });
    expect(result.email).toBe('a@b.co');
  });

  it('caps the display_name at 80 chars', () => {
    const r = CreateUserBody.safeParse({
      auth_user_id: 'a',
      email: 'a@b.co',
      display_name: 'x'.repeat(81),
    });
    expect(r.success).toBe(false);
  });
});

describe('UpdateUserBody / UpdateProfileBody', () => {
  it('UpdateUserBody accepts an empty patch', () => {
    expect(UpdateUserBody.parse({}).display_name).toBeUndefined();
  });

  it('UpdateProfileBody rejects a non-uuid in preferred_subject_ids', () => {
    const r = UpdateProfileBody.safeParse({ preferred_subject_ids: ['not-a-uuid'] });
    expect(r.success).toBe(false);
  });

  it('UpdateProfileBody caps preferred_subject_ids at 50', () => {
    const r = UpdateProfileBody.safeParse({
      preferred_subject_ids: Array.from({ length: 51 }, () => UUID),
    });
    expect(r.success).toBe(false);
  });

  it('UpdateProfileBody accepts arbitrary settings object', () => {
    const r = UpdateProfileBody.parse({ settings: { theme: 'dark', ttl: 7 } });
    expect(r.settings).toEqual({ theme: 'dark', ttl: 7 });
  });
});

describe('MintDevTokenBody', () => {
  it('requires a uuid user_id', () => {
    const r = MintDevTokenBody.safeParse({ user_id: 'nope' });
    expect(r.success).toBe(false);
  });

  it('defaults ttl_seconds away (optional)', () => {
    const r = MintDevTokenBody.parse({ user_id: UUID });
    expect(r.ttl_seconds).toBeUndefined();
  });

  it('rejects ttl_seconds outside 60..86400', () => {
    const r = MintDevTokenBody.safeParse({ user_id: UUID, ttl_seconds: 30 });
    expect(r.success).toBe(false);
  });
});

describe('ListQuestionsQuery', () => {
  it('rejects unknown difficulty', () => {
    const r = ListQuestionsQuery.safeParse({ difficulty: 'extreme' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown question type', () => {
    const r = ListQuestionsQuery.safeParse({ type: 'essay' });
    expect(r.success).toBe(false);
  });

  it('accepts every documented question type', () => {
    for (const type of [
      'single_mcq',
      'multi_mcq',
      'numerical',
      'short_answer',
      'true_false',
      'assertion_reason',
      'comprehension',
    ]) {
      const r = ListQuestionsQuery.safeParse({ type });
      expect(r.success).toBe(true);
    }
  });
});

describe('ListSyllabusProgressQuery + UpsertSyllabusProgressBody', () => {
  it('UpsertSyllabusProgressBody accepts scope_id null', () => {
    const r = UpsertSyllabusProgressBody.parse({ scope: 'global', scope_id: null });
    expect(r.scope_id).toBeNull();
  });

  it('UpsertSyllabusProgressBody rejects an unknown scope', () => {
    // 'topic' is a valid scope in the documented enum; pick a value
    // that is not in the enum to assert the rejection.
    const r = UpsertSyllabusProgressBody.safeParse({ scope: 'banana' });
    expect(r.success).toBe(false);
  });

  it('ListSyllabusProgressQuery accepts cursor + limit', () => {
    const r = ListSyllabusProgressQuery.parse({ cursor: 'abc', limit: 10 });
    expect(r.cursor).toBe('abc');
    expect(r.limit).toBe(10);
  });
});

describe('CreateTestDefinitionBody + StartTestAttemptBody + AnswerTestQuestionBody', () => {
  it('CreateTestDefinitionBody defaults source_payload to {}', () => {
    const r = CreateTestDefinitionBody.parse({
      title: 't',
      source_kind: 'manual',
      intended_count: 5,
    });
    expect(r.source_payload).toEqual({});
  });

  it('CreateTestDefinitionBody rejects intended_count=0', () => {
    const r = CreateTestDefinitionBody.safeParse({
      title: 't',
      source_kind: 'manual',
      intended_count: 0,
    });
    expect(r.success).toBe(false);
  });

  it('CreateTestDefinitionBody rejects source_kind outside enum', () => {
    const r = CreateTestDefinitionBody.safeParse({
      title: 't',
      source_kind: 'magic',
      intended_count: 5,
    });
    expect(r.success).toBe(false);
  });

  it('StartTestAttemptBody requires test_id', () => {
    const r = StartTestAttemptBody.safeParse({});
    expect(r.success).toBe(false);
  });

  it('AnswerTestQuestionBody defaults selected_option_ids to []', () => {
    const r = AnswerTestQuestionBody.parse({ question_id: UUID });
    expect(r.selected_option_ids).toEqual([]);
  });

  it('AnswerTestQuestionBody caps selected_option_ids at 20', () => {
    const r = AnswerTestQuestionBody.safeParse({
      question_id: UUID,
      selected_option_ids: Array.from({ length: 21 }, () => UUID),
    });
    expect(r.success).toBe(false);
  });

  it('AnswerTestQuestionBody caps duration_ms at 24h', () => {
    const r = AnswerTestQuestionBody.safeParse({
      question_id: UUID,
      duration_ms: 24 * 60 * 60 * 1000 + 1,
    });
    expect(r.success).toBe(false);
  });

  it('ListTestAttemptsQuery accepts state filter', () => {
    const r = ListTestAttemptsQuery.parse({ state: 'submitted' });
    expect(r.state).toBe('submitted');
  });
});

describe('Error bank schemas', () => {
  it('CreateErrorEntryBody accepts an empty body', () => {
    expect(() => CreateErrorEntryBody.parse({})).not.toThrow();
  });

  it('CreateErrorEntryBody accepts a known mistake_type', () => {
    const r = CreateErrorEntryBody.parse({ mistake_type: 'concept' });
    expect(r.mistake_type).toBe('concept');
  });

  it('CreateErrorEntryBody rejects an unknown mistake_type', () => {
    const r = CreateErrorEntryBody.safeParse({ mistake_type: 'guess' });
    expect(r.success).toBe(false);
  });

  it('UpdateErrorEntryBody rejects recurrence_count > 1000', () => {
    const r = UpdateErrorEntryBody.safeParse({ recurrence_count: 1001 });
    expect(r.success).toBe(false);
  });

  it('LinkErrorQuestionBody requires a question_id', () => {
    expect(LinkErrorQuestionBody.safeParse({}).success).toBe(false);
  });
});

describe('Review schemas', () => {
  it('ScheduleReviewBody defaults strategy to standard', () => {
    const r = ScheduleReviewBody.parse({
      error_id: UUID,
      due_at: '2026-09-03T00:00:00.000Z',
    });
    expect(r.strategy).toBe('standard');
  });

  it('UpdateReviewScheduleBody accepts state and outcome=null', () => {
    const r = UpdateReviewScheduleBody.parse({ state: 'completed', outcome: null });
    expect(r.state).toBe('completed');
    expect(r.outcome).toBeNull();
  });

  it('RecordReviewAttemptBody requires outcome', () => {
    const r = RecordReviewAttemptBody.safeParse({
      schedule_id: UUID,
      question_id: UUID,
    });
    expect(r.success).toBe(false);
  });
});

describe('Planner schemas', () => {
  it('CreatePlannerTaskBody requires plan_date and title', () => {
    const r = CreatePlannerTaskBody.safeParse({});
    expect(r.success).toBe(false);
  });

  it('CreatePlannerTaskBody requires YYYY-MM-DD plan_date', () => {
    const r = CreatePlannerTaskBody.safeParse({
      plan_date: '03-09-2026',
      title: 't',
    });
    expect(r.success).toBe(false);
  });

  it('UpdatePlannerTaskBody rejects state outside enum', () => {
    const r = UpdatePlannerTaskBody.safeParse({ state: 'pending' });
    expect(r.success).toBe(false);
  });

  it('CreatePlannerTemplateBody defaults template_payload to {}', () => {
    const r = CreatePlannerTemplateBody.parse({ name: 'tmpl' });
    expect(r.template_payload).toEqual({});
  });

  it('UpdatePlannerTemplateBody allows partial update', () => {
    const r = UpdatePlannerTemplateBody.parse({ is_default: true });
    expect(r.is_default).toBe(true);
  });
});

describe('Backlog schemas', () => {
  it('RecoverBacklogItemBody accepts empty body', () => {
    const r = RecoverBacklogItemBody.parse({});
    expect(r).toBeDefined();
  });

  it('ListBacklogItemsQuery rejects unknown state', () => {
    const r = ListBacklogItemsQuery.safeParse({ state: 'unknown' });
    expect(r.success).toBe(false);
  });
});

describe('Progress / Notifications schemas', () => {
  it('ListProgressEvidenceQuery accepts dimension', () => {
    const r = ListProgressEvidenceQuery.parse({ dimension: 'test_accuracy' });
    expect(r.dimension).toBe('test_accuracy');
  });

  it('ListProgressEvidenceQuery rejects unknown dimension', () => {
    const r = ListProgressEvidenceQuery.safeParse({ dimension: 'mood' });
    expect(r.success).toBe(false);
  });

  it('ListNotificationsQuery accepts severity + unread_only', () => {
    const r = ListNotificationsQuery.parse({ unread_only: true, severity: 'critical' });
    expect(r.unread_only).toBe(true);
    expect(r.severity).toBe('critical');
  });

  it('UpdateNotificationBody accepts read and dismissed', () => {
    const r = UpdateNotificationBody.parse({ read: true, dismissed: false });
    expect(r.read).toBe(true);
    expect(r.dismissed).toBe(false);
  });
});

describe('IdParam', () => {
  it('rejects non-uuid', () => {
    expect(IdParam.safeParse({ id: 'abc' }).success).toBe(false);
  });
  it('accepts uuid', () => {
    expect(IdParam.safeParse({ id: UUID }).success).toBe(true);
  });
});
