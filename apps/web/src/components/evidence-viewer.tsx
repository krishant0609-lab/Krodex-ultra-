/**
 * KRODEX web — Evidence viewer (Phase 9).
 *
 * Renders an authorized evidence snapshot from a short-lived
 * signed URL. The URL is generated server-side per request and
 * expires after the configured TTL (default 1 hour). When the
 * snapshot is unavailable (no asset, failed render, soft-deleted
 * storage object) the component falls back to the answer-text
 * view: the student's chosen answer and the expected answer,
 * side by side. This is the contract from TRD §10 — never
 * surface a broken image to the student.
 *
 * The viewer is a controlled leaf component: it owns nothing
 * besides the internal `img` error state. Snapshot fetching and
 * caching is the caller's responsibility.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { Spinner } from './spinner';
import { cls } from '../lib/classnames';
import type { EvidenceSnapshot } from '../lib/evidence-client';
import styles from './evidence-viewer.module.css';

export interface EvidenceViewerProps {
  /** Authorized snapshot descriptor, or null when no snapshot is available. */
  snapshot: EvidenceSnapshot | null;
  /** Student's answer, shown in the fallback view. */
  studentAnswer: string | null | undefined;
  /** Expected answer, shown in the fallback view. */
  expectedAnswer: string | null | undefined;
  /** Optional busy state. */
  isLoading?: boolean;
  /** Optional error message from the parent (e.g. fetch failure). */
  errorMessage?: string | null;
  /** Optional caption under the rendered image. */
  caption?: ReactNode;
  /** Optional extra className for the outer wrapper. */
  className?: string;
}

export function EvidenceViewer({
  snapshot,
  studentAnswer,
  expectedAnswer,
  isLoading = false,
  errorMessage = null,
  caption,
  className,
}: EvidenceViewerProps) {
  // The image can fail to load even when the URL is technically
  // valid (network blip, signed URL drift, asset deleted between
  // the metadata fetch and the render). We collapse that into the
  // same fallback surface so the UI never shows a broken-image
  // icon.
  const [imageFailed, setImageFailed] = useState(false);

  if (isLoading) {
    return (
      <div className={cls([styles.viewer, className])} data-testid="evidence-viewer-loading">
        <div className={styles.spinner}>
          <Spinner label="Loading snapshot" />
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className={cls([styles.viewer, className])} data-testid="evidence-viewer-error">
        <AnswerFallback
          title="We couldn't load this snapshot."
          body={errorMessage}
          studentAnswer={studentAnswer}
          expectedAnswer={expectedAnswer}
        />
      </div>
    );
  }

  if (snapshot && !imageFailed) {
    return (
      <div className={cls([styles.viewer, className])} data-testid="evidence-viewer-image">
        <img
          src={snapshot.url}
          alt="Evidence snapshot"
          className={styles.image}
          // The signed URL has its own short TTL; instruct the
          // browser to cache for at most the remaining lifetime.
          // We don't try to compute that client-side — `private`
          // alone is enough to keep shared caches out.
          crossOrigin="anonymous"
          onError={() => setImageFailed(true)}
          data-mime={snapshot.mimeType}
          data-byte-size={snapshot.byteSize}
        />
        {caption ? <p className={styles.meta}>{caption}</p> : null}
        <p className={styles.meta}>
          {humanByteSize(snapshot.byteSize)} · {snapshot.mimeType} · expires{' '}
          {formatExpiry(snapshot.expiresAt)}
        </p>
      </div>
    );
  }

  return (
    <div className={cls([styles.viewer, className])} data-testid="evidence-viewer-fallback">
      <AnswerFallback
        title={
          snapshot
            ? 'The snapshot could not be displayed.'
            : 'No snapshot is available for this attempt.'
        }
        body={
          snapshot
            ? 'The signed URL may have expired. Refreshing the page will request a new one.'
            : 'Your recorded answer is shown below for review.'
        }
        studentAnswer={studentAnswer}
        expectedAnswer={expectedAnswer}
      />
    </div>
  );
}

interface AnswerFallbackProps {
  title: string;
  body: string;
  studentAnswer: string | null | undefined;
  expectedAnswer: string | null | undefined;
}

function AnswerFallback({
  title,
  body,
  studentAnswer,
  expectedAnswer,
}: AnswerFallbackProps) {
  return (
    <div className={styles.fallback}>
      <p className={styles.fallbackTitle}>{title}</p>
      <p className={styles.fallbackBody}>{body}</p>
      <div className={styles.answerRow}>
        <span className={styles.answerLabel}>You chose</span>
        <span
          className={cls([
            styles.answerValue,
            !studentAnswer && styles.answerValueMuted,
          ])}
        >
          {studentAnswer?.trim() ? studentAnswer : '—'}
        </span>
      </div>
      <div className={styles.answerRow}>
        <span className={styles.answerLabel}>Expected</span>
        <span
          className={cls([
            styles.answerValue,
            !expectedAnswer && styles.answerValueMuted,
          ])}
        >
          {expectedAnswer?.trim() ? expectedAnswer : '—'}
        </span>
      </div>
    </div>
  );
}

function humanByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? value.toFixed(0) : value.toFixed(value < 10 ? 1 : 0);
  return `${fixed} ${units[i]}`;
}

function formatExpiry(iso: string): string {
  // Localized short expiry. The student doesn't need a full
  // date — they need to know the URL refreshes on next page load.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'soon';
  return d.toLocaleTimeString();
}
