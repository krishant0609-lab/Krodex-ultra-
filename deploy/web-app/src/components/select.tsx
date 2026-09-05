/**
 * KRODEX web — Select primitive.
 *
 * Native <select> styled to match Input. The chevron is painted
 * via CSS so the dropdown list still uses the platform's native
 * rendering. Forwards ref to the underlying <select>.
 *
 * Options can be supplied as children (<option>) or via the
 * `options` prop (string or { value, label, disabled }).
 */

'use client';

import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import styles from './control.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  options?: SelectOption[];
  placeholder?: string;
  children?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, options, placeholder, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={[styles.control, styles.select, invalid ? styles.invalid : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
});
