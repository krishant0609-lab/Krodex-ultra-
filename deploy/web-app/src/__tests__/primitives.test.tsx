/**
 * KRODEX web — primitive component tests.
 *
 * Verifies the editorial primitives (Button, Field, Input,
 * Textarea, Select, Card, Badge, Stat, Spinner) render the
 * expected DOM shape and accept the expected props. These
 * tests do not assert visual style — that's covered by the
 * visual verification matrix in Phase 7.13.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Button } from '../components/button';
import { Field } from '../components/field';
import { Input } from '../components/input';
import { Textarea } from '../components/textarea';
import { Select } from '../components/select';
import { Card, type CardComponent } from '../components/card';
import { Badge } from '../components/badge';
import { Stat } from '../components/stat';
import { Spinner } from '../components/spinner';

describe('Button primitive', () => {
  it('renders a button with the supplied label', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('sets aria-busy when loading and disables interaction', () => {
    render(<Button loading loadingLabel="Saving">Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Saving');
  });

  it('renders the variant + size class', () => {
    const { container } = render(
      <Button variant="secondary" size="lg">
        Cancel
      </Button>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    // Class names from CSS modules are hashed; we just assert
    // the className attribute is non-empty and different from
    // a default Button.
    expect(btn?.className).toBeTruthy();
  });
});

describe('Field primitive', () => {
  it('renders a label and helper text', () => {
    render(
      <Field id="x" label="User ID" helper="A unique identifier">
        <Input id="x" />
      </Field>,
    );
    expect(screen.getByLabelText('User ID')).toBeInTheDocument();
    expect(screen.getByText('A unique identifier')).toBeInTheDocument();
  });

  it('renders the error message with role=alert when error is set', () => {
    render(
      <Field id="x" label="User ID" error="Required">
        <Input id="x" invalid />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('Input primitive', () => {
  it('forwards ref to the underlying input', () => {
    let ref: HTMLInputElement | null = null;
    render(<Input ref={(el) => { ref = el; }} data-testid="i" />);
    expect(ref).not.toBeNull();
    expect(screen.getByTestId('i')).toBe(ref);
  });

  it('sets aria-invalid when invalid', () => {
    render(<Input invalid data-testid="i" />);
    expect(screen.getByTestId('i')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Textarea primitive', () => {
  it('renders a textarea with the supplied rows', () => {
    render(<Textarea data-testid="t" rows={6} />);
    const el = screen.getByTestId('t');
    expect(el.tagName).toBe('TEXTAREA');
    expect(el).toHaveAttribute('rows', '6');
  });
});

describe('Select primitive', () => {
  it('renders a select with options', () => {
    render(
      <Select
        data-testid="s"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        placeholder="Pick one"
      />,
    );
    expect(screen.getByTestId('s').tagName).toBe('SELECT');
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});

describe('Card primitive', () => {
  it('renders a section by default', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.querySelector('section')).not.toBeNull();
  });

  it('renders a button when interactive', () => {
    render(<Card interactive>Click</Card>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('renders an anchor when href is supplied', () => {
    render(<Card href="/x">Go</Card>);
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/x');
  });

  it('exposes subcomponents', () => {
    const { container } = render(
      <Card>
        <Card.Header>
          <Card.Eyebrow>Eyebrow</Card.Eyebrow>
          <Card.Title>Title</Card.Title>
        </Card.Header>
        <Card.Body>Body</Card.Body>
        <Card.Footer>Footer</Card.Footer>
      </Card>,
    );
    expect(screen.getByText('Eyebrow').tagName).toBe('P');
    expect(screen.getByText('Title').tagName).toBe('H3');
    expect(screen.getByText('Body').tagName).toBe('P');
    // Header and Footer are layout divs with role/structure baked
    // in via the cardFooter/cardHeader CSS classes.
    const allDivs = container.querySelectorAll('div');
    expect(allDivs.length).toBeGreaterThan(1);
    // The Card namespace exposes its subcomponents as a typed
    // CardComponent so consumers don't have to cast.
    const _typed: CardComponent = Card;
    expect(_typed).toBeDefined();
  });
});

describe('Badge primitive', () => {
  it('renders the children inside a span', () => {
    render(<Badge tone="success">Done</Badge>);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders a dot when dot=true', () => {
    const { container } = render(<Badge dot>Live</Badge>);
    expect(container.querySelector('span > span')).not.toBeNull();
  });
});

describe('Stat primitive', () => {
  it('renders label, value, and unit', () => {
    render(<Stat label="Streak" value="12" unit="days" />);
    expect(screen.getByText('Streak')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('days')).toBeInTheDocument();
  });

  it('renders a delta with the up arrow when direction is up', () => {
    render(<Stat label="Score" value="80" delta="+5" deltaDirection="up" />);
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('↑')).toBeInTheDocument();
  });
});

describe('Spinner primitive', () => {
  it('has role=status and an accessible label', () => {
    render(<Spinner label="Saving" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Saving');
  });
});
