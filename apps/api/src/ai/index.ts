/**
 * KRODEX API — Phase 8 AI module barrel.
 *
 * The five sub-modules:
 *   - provider.ts          — interface + message types
 *   - openai-provider.ts   — OpenAI-compatible REST implementation
 *   - provider.default.ts  — singleton + retry wrapper
 *   - adapter.ts           — Zod-validated provider call
 *   - schemas.ts           — Zod schemas for every AI input/output
 *   - classifier.ts        — error classification prompt + call
 *   - assistant.ts         — grounded retrieval + answer prompt
 *   - proposer.ts          — in-process TTL store for proposals
 *   - assistant-service.ts — orchestrator (auth → intent → call → respond)
 *   - intent.ts            — rule-based request intent classification
 *
 * The barrel re-exports the public surface (singletons, types,
 * schemas). Internal helpers (the message assembly, the JSON
 * extractor) are kept module-local.
 */

export {
  type AiMessageRole as AiMessageRoleT,
  type AiMessage,
  type AiRawResponse,
  type AiRequest,
  type AiProvider,
  RETRYABLE_HTTP_STATUSES,
} from './provider';
export { OpenAiCompatibleProvider } from './openai-provider';
export { createProvider, RetryingProvider } from './provider.default';
export {
  callProvider,
  type AdapterCallInput,
  type AdapterCallResult,
} from './adapter';
export {
  AssistantEvidenceKindSchema,
  AssistantEvidenceSchema,
  AssistantProposalSchema,
  AssistantQueryBodySchema,
  AssistantResponseSchema,
  ClassificationSuggestionResponseSchema,
  ClassificationSuggestionSchema,
  MistakeTypeSchema,
  ProposalConfirmBodySchema,
  ProposalKindSchema,
  type AssistantEvidenceKindT,
  type AssistantEvidenceT,
  type AssistantProposalT,
  type AssistantQueryBodyT,
  type AssistantResponseT,
  type ClassificationSuggestionResponseT,
  type ClassificationSuggestionT,
  type MistakeTypeT,
  type ProposalConfirmBodyT,
  type ProposalKindT,
} from './schemas';
