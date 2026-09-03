/**
 * KRODEX API — Phase 8 request intent classifier.
 *
 * The assistant endpoint accepts a free-form question from the
 * student. Before the orchestrator decides what to retrieve or
 * which AI pipeline to call, it first classifies the *intent* of
 * the request into one of the four documented buckets.
 *
 * The classifier is **rule-based, not AI-driven**, on purpose:
 *   - Intent routing is a small decision (which evidence set to
 *     pull, which prompt template to load) that does not benefit
 *     from a model call. A 200-character substring check is
 *     faster, cheaper, and auditable.
 *   - Per Implementation Plan §TRD-21 and Phase 8 Plan §14
 *     ("Class A — Intent classification: rule-based"), this stays
 *     out of the LLM hot path.
 *
 * Buckets:
 *   - 'classify'        — "what kind of mistake is this?"
 *   - 'explanation'     — "why is X the answer?" / "explain Y"
 *   - 'recommendation'  — "what should I do next?" / "schedule a review"
 *   - 'other'           — anything that does not match — defaults
 *                          to an answer-style Q&A.
 *
 * The function is pure: it takes a string and returns one of the
 * four intent literals. Tests do not need a real provider.
 */

export type RequestIntent = 'classify' | 'explanation' | 'recommendation' | 'other';

interface IntentPattern {
  intent: RequestIntent;
  /** Lower-case substring; first match wins (order matters). */
  patterns: readonly string[];
}

const RULES: readonly IntentPattern[] = [
  {
    intent: 'classify',
    patterns: [
      'classify this',
      'classify my',
      'classify the',
      'what kind of mistake',
      'what mistake type',
      'mistake type',
      'what went wrong',
      'why did i get this wrong',
      'categorize',
      'categorise',
      'tag this error',
    ],
  },
  {
    intent: 'explanation',
    patterns: [
      'explain',
      'why is',
      'why does',
      'how does',
      'how do',
      'show me the solution',
      'walk me through',
      'step by step',
      'show the work',
    ],
  },
  {
    intent: 'recommendation',
    patterns: [
      'what should i do',
      'what can i do',
      'how should i',
      'next step',
      'next steps',
      'schedule a review',
      'schedule review',
      'create a task',
      'add to planner',
      'recommend',
      'suggest a plan',
    ],
  },
];

export function classifyIntent(question: string): RequestIntent {
  const q = question.trim().toLowerCase();
  if (q.length === 0) return 'other';
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      if (q.includes(p)) return rule.intent;
    }
  }
  return 'other';
}
