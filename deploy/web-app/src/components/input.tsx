/**
 * KRODEX web — Input primitive.
 *
 * Single-line textual input. Forwards ref to the underlying
 * <input> so callers can focus/select. Pairs with <Field> for
 * label/helper/error layout.
 */

'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './control.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, mono = false, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={[
        styles.control,
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
