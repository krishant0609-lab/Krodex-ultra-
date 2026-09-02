/**
 * KRODEX web — query key registry.
 *
 * Every query key the TanStack Query cache uses is registered here.
 * Mutations invalidate by `key prefix` so we never have string-typed
 * caches scattered across hook files.
 *
 * The convention: `['module', 'subresource', ...params]`. Invalidation
 * uses prefix matching, e.g. `invalidateQueries({ queryKey: queryKeys.tasks() })`
 * refetches all variants of tasks queries.
 */

export const queryKeys = {
  // users
  currentUser: () => ['users', 'me'] as const,
  userProfile: () => ['users', 'me', 'profile'] as const,

  // syllabus
  subjects: () => ['syllabus', 'subjects'] as const,
  topics: (params?: { subjectId?: string; parentTopicId?: string | null }) =>
    ['syllabus', 'topics', params ?? {}] as const,
  subTopics: (topicId: string) =>
    ['syllabus', 'subTopics', topicId] as const,
  questions: (params?: Record<string, unknown>) =>
    ['syllabus', 'questions', params ?? {}] as const,
  questionOptions: (questionId: string) =>
    ['syllabus', 'questions', questionId, 'options'] as const,
  syllabusProgress: (params?: { scope?: string }) =>
    ['syllabus', 'progress', params ?? {}] as const,

  // tests
  tests: (params?: Record<string, unknown>) =>
    ['tests', 'definitions', params ?? {}] as const,
  test: (testId: string) => ['tests', 'definitions', testId] as const,
  testQuestions: (testId: string) =>
    ['tests', 'definitions', testId, 'questions'] as const,
  attempts: (params?: Record<string, unknown>) =>
    ['tests', 'attempts', params ?? {}] as const,
  attempt: (attemptId: string) =>
    ['tests', 'attempts', attemptId] as const,
  answers: (attemptId: string) =>
    ['tests', 'attempts', attemptId, 'answers'] as const,

  // errors
  errors: (params?: Record<string, unknown>) =>
    ['errors', params ?? {}] as const,
  errorEntry: (errorId: string) => ['errors', errorId] as const,

  // reviews
  reviews: (params?: Record<string, unknown>) =>
    ['review', 'schedules', params ?? {}] as const,
  review: (scheduleId: string) => ['review', 'schedules', scheduleId] as const,

  // planner
  tasks: (params?: Record<string, unknown>) =>
    ['planner', 'tasks', params ?? {}] as const,
  task: (taskId: string) => ['planner', 'tasks', taskId] as const,
  templates: (params?: Record<string, unknown>) =>
    ['planner', 'templates', params ?? {}] as const,
  template: (templateId: string) =>
    ['planner', 'templates', templateId] as const,

  // backlog
  backlog: (params?: Record<string, unknown>) =>
    ['backlog', params ?? {}] as const,
  backlogItem: (itemId: string) => ['backlog', itemId] as const,

  // progress evidence
  progressEvidence: (params?: Record<string, unknown>) =>
    ['progress', 'evidence', params ?? {}] as const,

  // analytics
  analyticsOverview: (params?: Record<string, unknown>) =>
    ['analytics', 'dashboards', 'overview', params ?? {}] as const,
  analyticsDimensions: (params?: Record<string, unknown>) =>
    ['analytics', 'dimensions', params ?? {}] as const,
  analyticsEvidence: (params?: Record<string, unknown>) =>
    ['analytics', 'evidence', params ?? {}] as const,

  // student model
  studentModel: () => ['student-model'] as const,

  // notifications
  notifications: (params?: Record<string, unknown>) =>
    ['notifications', params ?? {}] as const,
  notification: (notificationId: string) =>
    ['notifications', notificationId] as const,

  // health
  health: () => ['health'] as const,
} as const;
