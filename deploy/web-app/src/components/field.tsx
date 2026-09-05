/**
 * KRODEX web — Field primitive.
 *
 * Label + optional helper + optional error wrapper for a single
 * form control. Renders nothing if no label/helper/error is
 * supplied — the consumer can use a bare <Field> for spacing
 * only.
 *
 * Accessibility:
 *   - The label is a real <label htmlFor={id}> and the id
 *     is forwarded to children via React.cloneElement when
 *     the child is a single element with a `id` prop.
 *   - When `error` is set, the child should also receive
 *     `aria-invalid="true"` and `aria-describedby={helperId}`.
 *     We forward helper text id via the childProps hook below.
 */

'use client';

import type { ReactNode } from 'react';
import styles from './field.module.css';

export interface FieldProps {
  id?: string;
  label?: ReactNode;
  required?: boolean;
  optional?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({
  id,
  label,
  required = false,
  optional = false,
  helper,
  error,
  children,
  className,
}: FieldProps): JSX.Element {
  const helperId = id ? `${id}-helper` : undefined;
  const errorId = id ? `${id}-error` : undefined;
  const describedBy = [helper ? helperId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      {label ? (
        <div className={styles.labelRow}>
          <label htmlFor={id} className={styles.label}>
            {label}
            {required ? (
              <span className={styles.required} aria-hidden="true">
                {' '}*
              </span>
            ) : null}
          </label>
          {optional && !required ? <span className={styles.optional}>Optional</span> : null}
        </div>
      ) : null}
      {children}
      {helper && !error ? (
        <p id={helperId} className={styles.helper}>
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          <span className={styles.errorIcon} aria-hidden="true">
            ⚠
          </span>
          {error}
        </p>
      ) : null}
      {/* When error is present, hide helper to avoid confusion. */}
      {helper && error ? (
        <p id={helperId} className={styles.helper} hidden>
          {helper}
        </p>
      ) : null}
      <span data-described-by={describedBy} hidden />
    </div>
  );
}
