/**
 * KRODEX web — EvidenceViewer component tests (Phase 9).
 *
 * The viewer is a controlled leaf component. Its branches are:
 *
 *   1. loading — parent passes isLoading=true. A spinner renders,
 *      the image/answer UI does not.
 *   2. error — parent passes errorMessage. The answer-text
 *      fallback renders with that message.
 *   3. image — snapshot present, image not yet failed. An <img>
 *      with the signed URL is rendered.
 *   4. image failure — snapshot present but the <img> errors.
 *      The viewer falls back to the answer-text view.
 *   5. no snapshot — null. Answer-text fallback renders.
 *
 * We don't hit the network: the snapshot is passed in directly.
 * The image error path is exercised with a broken src.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EvidenceViewer } from '../components/evidence-viewer';
import type { EvidenceSnapshot } from '../lib/evidence-client';

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const SNAPSHOT: EvidenceSnapshot = {
  url: 'http://api.test/signed/snap.png?token=abc',
  mimeType: 'image/png',
  byteSize: 12_345,
  expiresAt: '2026-09-03T12:00:00.000Z',
};

describe('EvidenceViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the loading state when isLoading=true', () => {
    render(
      <EvidenceViewer
        snapshot={null}
        studentAnswer="42"
        expectedAnswer="43"
        isLoading
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId('evidence-viewer-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-viewer-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-viewer-fallback')).not.toBeInTheDocument();
  });

  it('renders the error state with the parent message', () => {
    render(
      <EvidenceViewer
        snapshot={null}
        studentAnswer="42"
        expectedAnswer="43"
        errorMessage="Network blip"
      />,
      { wrapper: makeWrapper() },
    );
    const errorNode = screen.getByTestId('evidence-viewer-error');
    expect(errorNode).toBeInTheDocument();
    expect(errorNode).toHaveTextContent("We couldn't load this snapshot.");
    expect(errorNode).toHaveTextContent('Network blip');
    expect(errorNode).toHaveTextContent('42');
    expect(errorNode).toHaveTextContent('43');
  });

  it('renders the image when a snapshot is present', () => {
    render(
      <EvidenceViewer
        snapshot={SNAPSHOT}
        studentAnswer="42"
        expectedAnswer="43"
      />,
      { wrapper: makeWrapper() },
    );
    const img = screen.getByTestId('evidence-viewer-image').querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', SNAPSHOT.url);
    expect(img).toHaveAttribute('data-mime', 'image/png');
  });

  it('falls back to answer text when the image fails to load', () => {
    render(
      <EvidenceViewer
        snapshot={SNAPSHOT}
        studentAnswer="42"
        expectedAnswer="43"
      />,
      { wrapper: makeWrapper() },
    );
    const img = screen
      .getByTestId('evidence-viewer-image')
      .querySelector('img');
    expect(img).toBeInTheDocument();
    // The viewer watches onError; simulating it collapses the
    // image branch into the fallback branch.
    fireEvent.error(img!);
    expect(screen.getByTestId('evidence-viewer-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-viewer-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('evidence-viewer-fallback')).toHaveTextContent('42');
    expect(screen.getByTestId('evidence-viewer-fallback')).toHaveTextContent('43');
  });

  it('falls back to answer text when no snapshot is available', () => {
    render(
      <EvidenceViewer
        snapshot={null}
        studentAnswer="42"
        expectedAnswer="43"
      />,
      { wrapper: makeWrapper() },
    );
    const fallback = screen.getByTestId('evidence-viewer-fallback');
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveTextContent(
      'No snapshot is available for this attempt.',
    );
    expect(fallback).toHaveTextContent('42');
    expect(fallback).toHaveTextContent('43');
  });

  it('shows a muted dash when the student answer is missing', () => {
    render(
      <EvidenceViewer
        snapshot={null}
        studentAnswer={null}
        expectedAnswer="43"
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId('evidence-viewer-fallback')).toHaveTextContent('—');
  });
});
