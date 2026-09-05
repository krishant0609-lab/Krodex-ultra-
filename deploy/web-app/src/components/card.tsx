/**
 * KRODEX web — Card primitive.
 *
 * Surface wrapper with tone, padding, and optional interactivity.
 * Companion subcomponents: Card.Header, Card.Eyebrow,
 * Card.Title, Card.Body, Card.Footer.
 *
 * The default export is a forwardRef <section>. Pass
 * `interactive` to make it a <button>. Pass `href` to make it
 * an <a>. Both can be combined with the underlying element via
 * children composition.
 */

'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './card.module.css';
import { cls } from '../lib/classnames';

export type CardTone = 'raised' | 'sunken' | 'outline';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  padding?: CardPadding;
  interactive?: boolean;
  href?: string;
  children?: ReactNode;
}

function toneClass(tone: CardTone): string | undefined {
  return tone === 'sunken'
    ? styles.toneSunken
    : tone === 'outline'
      ? styles.toneOutline
      : styles.toneRaised;
}

function paddingClass(p: CardPadding): string | undefined {
  return p === 'none'
    ? styles.paddingNone
    : p === 'sm'
      ? styles.paddingSm
      : p === 'md'
        ? styles.paddingMd
        : p === 'lg'
          ? styles.paddingLg
          : styles.paddingMd;
}

const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    tone = 'raised',
    padding = 'md',
    interactive = false,
    href,
    className,
    children,
    ...rest
  },
  ref,
) {
  const klass = cls([
    styles.card,
    toneClass(tone),
    paddingClass(padding),
    interactive ? styles.interactive : undefined,
    className,
  ]);

  if (href !== undefined) {
    return (
      <a ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={klass} {...rest}>
        {children}
      </a>
    );
  }

  if (interactive) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={klass}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <section ref={ref} className={klass} {...rest}>
      {children}
    </section>
  );
});

// Augment Card with subcomponents. The forwardRef return value
// carries the type of the wrapped component only, so we use a
// namespace-style augmentation: cast the exported Card to a
// CardComponent type that includes the subcomponents.

interface CardPartProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
  children?: ReactNode;
  /** Heading level. Default 3. */
  level?: 2 | 3 | 4 | 5 | 6;
};

function CardPart({ className, children, ...rest }: CardPartProps): JSX.Element {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}

function CardHeader(props: CardPartProps): JSX.Element {
  return <CardPart {...props} className={cls([styles.cardHeader, props.className])} />;
}
function CardEyebrow(props: CardPartProps): JSX.Element {
  return (
    <p
      {...(props as HTMLAttributes<HTMLParagraphElement>)}
      className={cls([styles.cardEyebrow, props.className])}
    />
  );
}
function CardTitle({ level = 3, className, children, ...rest }: CardTitleProps): JSX.Element {
  // Render the requested heading level while preserving the
  // cardTitle typography. Consumers MUST pick a level that
  // fits their page's heading order (no skipping).
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Tag {...rest} className={cls([styles.cardTitle, className])}>
      {children}
    </Tag>
  );
}
function CardBody(props: CardPartProps): JSX.Element {
  return (
    <p
      {...(props as HTMLAttributes<HTMLParagraphElement>)}
      className={cls([styles.cardBody, props.className])}
    />
  );
}
function CardFooter(props: CardPartProps): JSX.Element {
  return <CardPart {...props} className={cls([styles.cardFooter, props.className])} />;
}

// Augment the Card export with a typed CardComponent view that
// includes its subcomponents, so callers (and tests) can use
// Card.Header / Card.Body / etc. without per-call casts.
type CardComponent = typeof Card & {
  Header: typeof CardHeader;
  Eyebrow: typeof CardEyebrow;
  Title: typeof CardTitle;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
};

const CardWithParts = Card as CardComponent;
CardWithParts.Header = CardHeader;
CardWithParts.Eyebrow = CardEyebrow;
CardWithParts.Title = CardTitle;
CardWithParts.Body = CardBody;
CardWithParts.Footer = CardFooter;

// Re-export the augmented component so consumers get the
// CardComponent type, not the bare forwardRef result.
export { CardWithParts as Card };
export type { CardComponent };
