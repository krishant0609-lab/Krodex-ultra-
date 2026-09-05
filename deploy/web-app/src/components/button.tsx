/**
 * KRODEX web — Button primitive.
 *
 * Editorial primary / secondary / ghost / danger with three sizes
 * and a loading state. Renders as <button> by default; can be
 * rendered as a <Link> via `asChild` and the underlying href.
 *
 * All cosmetic values resolve to design tokens. The component
 * is forwardRef-aware so callers can attach refs (e.g. to focus).
 */

'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './button.module.css';
import { cls } from '../lib/classnames';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    loadingLabel,
    leadingIcon,
    trailingIcon,
    disabled,
    type = 'button',
    className,
    children,
    ...rest
  },
  ref,
) {
  const sizeClass =
    size === 'sm' ? styles.sizeSm : size === 'lg' ? styles.sizeLg : styles.sizeMd;
  const variantClass =
    variant === 'primary'
      ? styles.variantPrimary
      : variant === 'secondary'
        ? styles.variantSecondary
        : variant === 'ghost'
          ? styles.variantGhost
          : styles.variantDanger;
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cls([
        styles.button,
        sizeClass,
        variantClass,
        block ? styles.block : undefined,
        loading ? styles.loading : undefined,
        className,
      ])}
      {...rest}
    >
      {loading ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span>{loadingLabel ?? 'Loading…'}</span>
        </>
      ) : (
        <>
          {leadingIcon ? <span aria-hidden="true">{leadingIcon}</span> : null}
          <span>{children}</span>
          {trailingIcon ? <span aria-hidden="true">{trailingIcon}</span> : null}
        </>
      )}
    </button>
  );
});
