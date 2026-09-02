/**
 * KRODEX web — Textarea primitive.
 *
 * Multi-line textual input. Forwards ref to the underlying
 * <textarea>. Pairs with <Field> for label/helper/error.
 */

'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import styles from './control.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, mono = false, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={[
        styles.control,
        styles.textarea,
        invalid ? styles.invalid : '',
        mono ? styles.mono : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});
