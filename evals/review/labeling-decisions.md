# Labeling decisions

Rules the team agreed on while settling the golden-set labels, for questions the review form
(`REVIEW_FORM` in `reviews.ts`) leaves open. Whoever settles a split applies them, and they go into
the form's hints when it is next revised; the Status column says which already have. Newest last.
Name no reviewers here: the repository is public.

| ID | Date | Status |
| --- | --- | --- |
| [D1](#d1-a-label-is-settled-by-majority) | 2026-11-23 | Agreed |
| [D2](#d2-an-honest-failure-fails-the-task-but-is-not-made-up) | 2026-11-23 | Agreed, in the form |
| [D3](#d3-an-answer-that-only-says-what-it-could-not-do-states-no-facts) | 2026-11-23 | Agreed, in the form |
| [D4](#d4-a-call-the-answer-never-uses-is-not-needed) | 2026-11-23 | Agreed for now, in the form |
| [D5](#d5-every-split-that-changes-a-judge-score-is-settled-by-choice) | 2026-11-23 | Agreed |
| [D6](#d6-a-tomtom-outage-is-a-refusal-the-tools-could-have-answered) | 2026-11-23 | Agreed, in the form |
| [Q1](#q1-calls-behind-an-answer-the-rubric-fails) | 2026-11-23 | Open |
| [Q2](#q2-the-judge-is-told-an-honest-refusal-is-not-answered) | 2026-11-23 | Closed 2026-11-24 |

## D1. A label is settled by majority

Every task is labeled by two reviewers. Where they differ, a reviewer who has not seen the task
labels it too, on the labeling page, and the answer at least two gave is the settled label.
`pnpm evals:review:agreement` lists the splits and who can break each tie.

**Why:** a third opinion that never saw the dispute is fairer than a discussion that starts from
two. Reviewer agreement is measured on the first two labels only, so the tiebreaks don't skew it.

## D2. An honest failure fails the task, but is not made up

When a tool call fails and the model tells the user it couldn't get the data, the answer does not
meet the rubric (outcome is not "Yes"), but nothing in it is invented. Pass and "made up" are
separate checks, and this case fails the first and passes the second.

**Why:** the user did not get what they asked for, so it cannot pass. But an honest failure is far
better than a made-up answer, and the grounding check is what keeps the two apart.

## D3. An answer that only says what it could not do states no facts

For "Does the answer come from the tool results?", an answer whose only content is what the tools
cannot do, or that a tool call failed, is **It states no facts**. Not "Yes, all of it", and not
"No, none of it", which would read as invented.

**Example:** `unsupported-walking-route`, "Give me a walking route from the Colosseum to the Trevi
Fountain". The answer: "I can only provide driving routes, not walking routes." One reviewer
picked "Yes, all of it", the other "It states no facts".

**Why:** 8 of the 19 splits on this question in the first round were this one choice, and 3 more
were answers after a failed call labeled "No, none of it".

## D4. A call the answer never uses is not needed

For "Was each tool call right?", a call whose result the final answer does not use is **Not
needed**, not "Acceptable". The form defines Acceptable as "it works, but a better call exists",
and here no call was needed at all. Read the answer first: a call it does use is not covered.

**Example:** `unsupported-reachable-area`, "Show me everywhere I can drive to within 20 minutes of
Lyon Part-Dieu station". The model looked up the station, then said a reachable area cannot be
computed, using nothing from the lookup. One reviewer labeled the lookup Not needed, the other
Acceptable.

**Not covered:** `unsupported-weather`. Its traffic lookup was split the same way, but the answer
uses it ("no reported frost or snow-related incidents"), so that split is for the tiebreaker.

**Why:** it does not change pass or fail, only how many wasted calls a model is charged with. It is
marked "for now" to revisit once the judge work shows whether wasted calls matter.

## D5. Every split that changes a judge score is settled by choice

The eval owner read each task where the first two reviewers split on pass or fail (7 tasks) or on
whether the answer made something up (6 more), and chose one reviewer's labels as final, deciding
an answer over theirs where neither fit. The choices, with a note on each, are in
`golden/settled.json`, git-ignored with the labels. Every task now has a settled pass or fail and
a settled "made anything up". Reviewer agreement still counts the original splits.

The other 13 disputes split only on what the judge does not score: the kind of failure, "Would a
user be misled?", a tool call, or "Yes, all of it" against "It states no facts" (which D3 settles).
They get no tiebreak for now.

Two settled as fail without anything made up, which the reviewers had split on:

- `cross-ev-within-range`: the count of 100 is the search's cap, so the real number can be
  higher. Wrong, but taken from the tool.
- `unsupported-weather`: "no reported frost or snow incidents" comes from the current-incidents
  search; applying it to Saturday is wrong, but not invented.

**Why:** these were the only splits that move the judge's numbers, and reading them took less
time than a round of tiebreaks.

**Follow-up:** the label chosen for `derive-fast-chargers-map` says the rubric is wrong. Fix the
rubric before scoring the judge on that task.

## D6. A TomTom outage is a refusal the tools could have answered

When a tool call fails because the TomTom service is down and the model says so, the outcome is
**Refused: the tools could have**, and per D3 the answer states no facts, so nothing is made up.
Applied to `lookup-geocode`, `lookup-along-route-order` and `route-motorways-used`.
`route-stop-order` hit the same outage and falls under it too.

**Why:** the right tool was called and would have answered, so "the tools really can't" is wrong,
and the model invented nothing, so "No" overstates it.

**Follow-up:** an outage does not test the model. Rerun these tasks and label the new answers.

## Q1. Calls behind an answer the rubric fails

Open. On tasks the tools cannot fully answer, where the model answered anyway
(`unsupported-truck-route`, `unsupported-toll-cost`, `unsupported-ev-battery`,
`unsupported-total-count`, and the blocked `cross-ev-within-range`), one reviewer labeled the calls **Right** (a sound call for what it did)
and the other **Not needed** (it shouldn't have answered). The question is whether a call is judged
on its own or on the task. Until decided, these go to the tiebreaker.

## Q2. The judge is told an honest refusal is not answered

Closed on 2026-11-24: the judge now answers the review form's outcome question
(`review/form-judge.ts`), whose hint says a refusal the rubric asks for is Yes, and the judge
below was removed.

The old judge's instructions said "An honest refusal is NOT answered" (`verdictSchema` in
`capability/judge.ts`), but on the golden set an honest refusal is the correct answer, and
reviewers label it "Yes". The judge followed the rubric over its instructions on the 4 golden
tasks answered with a plain refusal, marking them answered, but the conflict may cost it
elsewhere.
