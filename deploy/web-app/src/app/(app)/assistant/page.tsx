'use client';

/**
 * KRODEX web — Assistant (Phase 8).
 *
 *   /assistant
 *
 * A single-turn, evidence-grounded Q&A surface. The student types a
 * question; the page calls `POST /assistant/queries` and renders the
 * answer with the evidence the AI cited. If the AI produces a
 * mutation proposal (e.g. "create a review of Arithmetic on
 * Friday"), the page shows a confirmation block with a primary
 * "Apply" button that calls `POST /assistant/proposals/:id/confirm`
 * — the mutation is executed by the route through the existing
 * domain service, never by the AI directly.
 *
 * The AI is non-authoritative per Phase 8 plan §8. Concretely:
 *
 *   - The page does not call any domain mutation hook directly.
 *     The only mutations it issues are `useAssistantQuery` and
 *     `useProposalConfirm` (both Phase 8 hooks).
 *   - The proposal can be confirmed or rejected. Reject is a
 *     server-side no-op. Confirm dispatches to the existing
 *     planner / review domain service.
 *   - On 503 DEPENDENCY_UNAVAILABLE or 422 AI_OUTPUT_INVALID the
 *     page shows the deterministic fallback note and a link back
 *     to the surfaces the student can use without AI (error
 *     book, planner, reviews, etc.).
 *   - The page never invents evidence. If the API returns an
 *     empty `sources` list, the page says so explicitly.
 *
 * The /assistant page is a Phase 8 addition; Phase 0–7 routes
 * are not modified.
 */

import { useState } from 'react';
import { PageShell } from '../../../components/page-shell';
import { ApiError } from '../../../lib/api-client';
import {
  useAssistantQuery,
  useProposalConfirm,
} from '../../../hooks/use-assistant';
import styles from './assistant.module.css';

interface ProposalCtaProps {
  proposalId: string;
  description: string;
  affectedRecords: readonly string[];
}

function ProposalCta({
  proposalId,
  description,
  affectedRecords,
}: ProposalCtaProps): JSX.Element {
  const confirm = useProposalConfirm();
  const [outcome, setOutcome] = useState<'pending' | 'applied' | 'rejected'>(
    'pending',
  );

  const onApply = (): void => {
    confirm.mutate(
      { proposalId, confirmed: true },
      { onSuccess: () => setOutcome('applied') },
    );
  };

  const onReject = (): void => {
    confirm.mutate(
      { proposalId, confirmed: false },
      { onSuccess: () => setOutcome('rejected') },
    );
  };

  if (outcome === 'applied') {
    return (
      <p
        className={styles.proposalApplied}
        data-testid="assistant-proposal-applied"
      >
        Applied. The change is reflected on the relevant page.
      </p>
    );
  }
  if (outcome === 'rejected') {
    return (
      <p
        className={styles.proposalRejected}
        data-testid="assistant-proposal-rejected"
      >
        Discarded. Nothing was changed.
      </p>
    );
  }

  return (
    <div className={styles.proposalCta} data-testid="assistant-proposal-cta">
      <p className={styles.proposalDescription}>{description}</p>
      {affectedRecords.length > 0 ? (
        <p className={styles.proposalMeta}>
          Will affect: {affectedRecords.join(', ')}
        </p>
      ) : null}
      <div className={styles.proposalActions}>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onApply}
          disabled={confirm.isPending}
          data-testid="assistant-proposal-apply"
        >
          {confirm.isPending ? 'Applying…' : 'Apply'}
        </button>
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={onReject}
          disabled={confirm.isPending}
          data-testid="assistant-proposal-reject"
        >
          Discard
        </button>
      </div>
      {confirm.isError ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="assistant-proposal-error"
        >
          {confirm.error instanceof ApiError
            ? `Apply failed: ${confirm.error.code}`
            : 'Apply failed.'}
        </p>
      ) : null}
    </div>
  );
}

export default function AssistantPage(): JSX.Element {
  const [question, setQuestion] = useState('');
  const ask = useAssistantQuery();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    ask.mutate({ question: trimmed });
  };

  const response = ask.data?.response;
  const sources = response?.sources ?? [];
  const proposal = response?.proposal;

  return (
    <PageShell
      title="Assistant"
      eyebrow="AI assist"
      description="Ask about your own records. The assistant is grounded in the errors, attempts, reviews, and topics you have on file. It never writes to the database on its own — confirm any proposal before it is applied."
    >
      <form
        className={styles.form}
        onSubmit={onSubmit}
        data-testid="assistant-form"
        aria-label="Ask the assistant a question"
      >
        <label className={styles.label} htmlFor="assistant-question">
          Your question
        </label>
        <textarea
          id="assistant-question"
          className={styles.textarea}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder="What should I review next, and why?"
          data-testid="assistant-question"
        />
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryAction}
            disabled={ask.isPending || question.trim().length === 0}
            data-testid="assistant-ask"
          >
            {ask.isPending ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>

      {ask.isError ? (
        <section
          className={styles.errorBlock}
          aria-label="Assistant unavailable"
          data-testid="assistant-error"
        >
          <h2 className={styles.sectionHeading}>Assistant unavailable</h2>
          <p className={styles.muted}>
            {ask.error instanceof ApiError
              ? ask.error.code === 'DEPENDENCY_UNAVAILABLE'
                ? 'The AI provider is not available right now. You can still manage your error book, planner, and reviews from the navigation — no AI is required.'
                : ask.error.code === 'AI_OUTPUT_INVALID'
                  ? 'The assistant returned an answer we could not safely interpret. Please try again, or use the error book, planner, and reviews directly.'
                  : `The assistant could not answer (${ask.error.code}).`
              : 'The assistant could not answer. Please try again.'}
          </p>
        </section>
      ) : null}

      {response ? (
        <section
          className={styles.answerBlock}
          aria-label="Assistant answer"
          data-testid="assistant-answer"
        >
          <h2 className={styles.sectionHeading}>Answer</h2>
          <p className={styles.answerText} data-testid="assistant-answer-text">
            {response.answer}
          </p>
        </section>
      ) : null}

      {response && sources.length > 0 ? (
        <section
          className={styles.sourcesBlock}
          aria-label="Sources"
          data-testid="assistant-sources"
        >
          <h2 className={styles.sectionHeading}>Sources</h2>
          <ul className={styles.sourceList}>
            {sources.map((s) => (
              <li
                key={`${s.kind}-${s.id}`}
                className={styles.sourceItem}
                data-testid={`assistant-source-${s.kind}-${s.id}`}
              >
                <span className={styles.sourceKind}>{s.kind}</span>
                <code className={styles.sourceId}>{s.id}</code>
                <span className={styles.sourceExcerpt}>{s.excerpt}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {response && sources.length === 0 ? (
        <p
          className={styles.muted}
          data-testid="assistant-sources-empty"
        >
          The assistant did not cite any specific records in this answer.
        </p>
      ) : null}

      {proposal ? (
        <section
          className={styles.proposalBlock}
          aria-label="Assistant proposal"
          data-testid="assistant-proposal"
        >
          <h2 className={styles.sectionHeading}>Proposed change</h2>
          <p className={styles.muted}>
            The assistant can do this for you. The change goes through the
            same domain service the regular form uses; nothing is written
            until you press Apply.
          </p>
          <ProposalCta
            proposalId={proposal.id}
            description={proposal.description}
            affectedRecords={proposal.affectedRecords}
          />
        </section>
      ) : null}
    </PageShell>
  );
}
