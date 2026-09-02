# KRODEX — Phase 2 Grading Decisions (Locked)

> Status: **LOCKED** for Phase 2 implementation. Any deviation requires an
> explicit Phase change request and a new entry below.

The five governing specifications
([PRD](../specs/KRODEX_Detailed_PRD_From_Scratch_v2.txt),
[TRD](../specs/KRODEX_TRD_From_Scratch_v2.txt),
[Schema-Ready](../specs/KRODEX_Schema_Ready_Specification_From_Scratch_v2.txt),
[Engineering Support](../specs/KRODEX_Engineering_Support_Specification_5_in_1_v2.txt),
[Implementation Plan](../specs/KRODEX_Project_Implementation_Plan_From_Scratch_v2.txt))
do not specify, in normative language, the per-`QuestionType` grading
behavior of `test_answers.outcome` or the per-test accuracy formula.
Before implementing question grading the project lead was asked, per
the explicit Phase 2 instruction, to surface each unspec'd decision
rather than silently inventing one. The six decisions below were
approved verbatim and are now the authoritative grading contract for
Phase 2. Future phases that change these rules MUST update this file
in the same change.

---

## Decision 1 — Where scoring config lives

**Recommendation A (approved).** Scoring config is stored inside
`public.test_definitions.source_payload` under the JSON path
`scoring`. The column itself is `jsonb` (see
`supabase/migrations/20260901164346_03_core_schema.sql`) so no schema
change is required. A `TestDefinitionRow` therefore carries the scoring
rules the API must apply at submit time. Reading the scoring rules
without first reading the `TestDefinitionRow` is a programming error.

**Rationale.** Keeping the rules with the test keeps test scoring
deterministic and replayable: a test is graded by the rules that
existed at the time the attempt was opened. The alternative (a global
scoring policy table) couples every test to a single organization-wide
policy, which conflicts with the PRD's "versioned scoring rules per
test" guidance.

**Schema (informative).** A scoring config is a JSON object that
always has the shape:

```jsonc
{
  "version": 1,                          // integer; required
  "defaultOutcome": "incorrect",         // "correct" | "incorrect" | "partial" | "skipped"
  "byQuestionType": {
    "single_mcq":      { /* rule */ },
    "multi_mcq":       { /* rule */ },
    "numerical":       { /* rule */ },
    "short_answer":    { /* rule */ },
    "true_false":      { /* rule */ },
    "assertion_reason":{ /* rule */ },
    "comprehension":   { /* rule */ }
  },
  "numericTolerance": 1e-9,              // number; default 1e-9
  "partialCredit":     0.5               // number in [0, 1]; default 0.5
}
```

Each per-type rule uses the shape documented in
[`PHASE2_SCORING_RULES.md`](../specs/PHASE2_SCORING_RULES.md) (to be
added in a follow-up). The API MUST validate every `source_payload`
on insert/update against a zod schema derived from this shape.

## Decision 2 — Per-QuestionType grading rules

**Recommendation B (approved, all seven QuestionTypes).** The grading
rule for every `QuestionType` lives in
`test_definitions.source_payload.scoring.byQuestionType[<type>]`.
There is no built-in default rule per type; if the rule is missing,
the answer outcome is **`incorrect`** (Decision 1's `defaultOutcome`).
Phase 2 will validate the presence of every per-type rule and reject
saves that omit a rule. Future QuestionTypes must be added in lockstep
on both sides.

**Rationale.** The seven current `QuestionType` values are
heterogeneous enough that a uniform built-in rule is not meaningful
(consider `numerical` vs `assertion_reason`); the test owner must
declare the rule at test creation. Versioned rules (`version: 1`)
allow us to evolve the rule shape without invalidating historical
attempts.

## Decision 3 — Accuracy formula

**Recommendation B (approved).** Accuracy is computed and stored on
`public.test_attempts.accuracy` as

```
accuracy = correct_count / (correct_count + incorrect_count + partial_count)
```

`skipped_count` is **excluded** from the denominator. If the
denominator is zero (i.e. the attempt has no `correct`, `incorrect`,
or `partial` answers) accuracy is `0` and the submit RPC stores
`"0"`. The denominator is never negative; the RPC rejects the submit
if it is.

**Rationale.** The PRD describes accuracy as "the fraction of
answered questions that were right" (§11, paraphrased). Excluding
`skipped` matches that plain reading and prevents a "skip-everything"
attempt from appearing artificially perfect.

## Decision 4 — Unanswered questions

**Recommendation B (approved).** When a test attempt is submitted,
every question that the attempt has no `test_answers` row for becomes
a `test_answers` row with `outcome = 'skipped'`. The submit RPC
inserts these rows in the same transaction that updates the attempt
so that the post-submit invariant

> "every question attached to a submitted attempt has exactly one
> `test_answers` row"

holds atomically.

**Rationale.** The PRD requires test attempts to be a complete
record (§11). Leaving the answer missing would force every consumer
of `test_answers` to also consider the absence of a row, which
collides with the per-attempt `count_*` columns on `test_attempts`
and is the kind of invariant the database is best at enforcing.

## Decision 5 — Comprehension / Assertion-Reason outcome at submit

**Recommendation A (approved).** At submit time, the per-`QuestionType`
rule for `comprehension` and `assertion_reason` MUST record the
answer outcome as `partial`. No AI or teacher step is invoked at
submit. A later review (Phase 3+, out of scope) may revise the final
outcome (the `test_answers` column is nullable to support this).

**Rationale.** The five governing specifications do not define
automatic grading for free-text, comprehension, or assertion-reason
questions. Recording `partial` at submit is the only honest outcome
that does not silently award full or zero marks to a question whose
real grade requires human or AI judgement. The row stays mutable so
a later review can adjust the final outcome without rewriting the
submit history.

## Decision 6 — When a partial answer becomes an ErrorEntry

**Recommendation A (approved).** Only answers whose final outcome is
`incorrect` create a row in `public.error_entries` (and a
`error_question_links` link). `partial` answers are **not**
auto-promoted to errors. The submit RPC walks the per-question
outcomes, finds the `incorrect` ones, and creates one
`error_entries` row per offending question (per question, not per
attempt: a single question recurring across attempts upserts the
existing error).

**Rationale.** Treating `partial` as "a candidate error" would
overload the Error Bank with borderline answers; treating only
`incorrect` matches the PRD's Error Bank semantics and the Schema-Ready
"ErrorEntry is created for answers graded as incorrect" rule
(§7.2). The reviewer is free to manually promote a `partial` answer
into an error later via the `errors` service (separate API).

---

## What Phase 2 implements, in one line

> At submit, every unattached question becomes `skipped`. Every
> attached question is graded by the rule in
> `test_definitions.source_payload.scoring.byQuestionType[<type>]`,
> defaulting to `incorrect` if the rule is missing. `comprehension`
> and `assertion_reason` always resolve to `partial` at submit. The
> `test_attempts` accuracy column is `correct / (correct + incorrect
> + partial)`. Only `incorrect` answers create an `error_entries`
> row. All of this happens inside a single Postgres RPC
> (`public.submit_test_attempt`) so the resulting state is atomic.

This document is the single source of truth for the above. Code that
disagrees with it is wrong.
