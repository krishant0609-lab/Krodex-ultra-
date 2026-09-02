/**
 * KRODEX web — Hero.
 *
 * Editorial hero for the unauthenticated root index. Per
 * Phase 7 plan S17 / S18, the home page is honest: it tells
 * the user what KRODEX is, surfaces a single CTA to sign in,
 * and never fabricates metrics, scores, or sample data.
 *
 * Composition: eyebrow, display title, body description, and
 * an actions slot. Callers pass a single primary CTA — the
 * root page passes a Button that links to /login.
 */

'use client';

import type { ReactNode } from 'react';
import { Badge } from './badge';
import styles from './hero.module.css';

export interface HeroProps {
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  /** Display title (h1). */
  title: ReactNode;
  /** Body copy below the title. */
  description?: ReactNode;
  /** Action slot (Button, etc.). */
  actions?: ReactNode;
  /** Meta line below the actions. Rendered only if provided. */
  meta?: ReactNode;
  /** Optional accent dot for the meta line. */
  metaAccent?: 'lavender' | 'emerald' | 'amber' | 'rose' | 'sapphire' | 'champagne';
}

const META_DOT_CLASS: Record<NonNullable<HeroProps['metaAccent']>, string> = {
  lavender: 'var(--kd-color-accent-lavender)',
  emerald: 'var(--kd-color-accent-emerald)',
  amber: 'var(--kd-color-accent-amber)',
  rose: 'var(--kd-color-accent-rose)',
  sapphire: 'var(--kd-color-accent-sapphire)',
  champagne: 'var(--kd-color-accent-champagne)',
};

export function Hero({
  eyebrow,
  title,
  description,
  actions,
  meta,
  metaAccent = 'lavender',
}: HeroProps): JSX.Element {
  return (
    <section className={styles.hero} data-testid="hero">
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 className={styles.title} data-testid="hero-title">
        {title}
      </h1>
      {description ? <p className={styles.description}>{description}</p> : null}
      {actions ? (
        <div className={styles.actions} data-testid="hero-actions">
          {actions}
        </div>
      ) : null}
      {meta ? (
        <div className={styles.metaRow} data-testid="hero-meta">
          <span
            className={styles.metaDot}
            aria-hidden="true"
            style={{ background: META_DOT_CLASS[metaAccent] }}
          />
          <span>{meta}</span>
        </div>
      ) : null}
    </section>
  );
}

export { Badge as HeroBadge };
