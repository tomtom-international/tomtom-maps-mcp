# Phase comparison

Model: gpt-5.1 · wiring: stdio · 3 capability run(s) per phase · generated 2026-09-03T11:24:11.824Z

Runs were interleaved (phase 0, 1, 2, 3 · phase 0, 1, 2, 3 · …) so drift in the live
APIs cannot land on one phase and read as a result. Capability figures are medians;
the range beside each is the spread across repeats, and a wide one means the metric
cannot separate these phases at this sample size.

## What each phase adds

| Phase | Adds | Model-visible tools |
| --- | --- | ---: |
| **0. Before the consolidation** | — | 15 |
| **1. Consolidated tools** | Fewer, wider tools — no new capability | 9 |
| **2. Code execution, no state** | `analyse` — code over this call's own result | 9 |
| **3. Server-held datasets** | `dataset_id` handles + `describe-dataset` / `analyse-data` | 11 |

## Capability — medians

| Metric | phase0 (median) | phase1 (median) | phase2 (median) | phase3 (median) |
| --- | ---: | ---: | ---: | ---: |
| answered | 8 <sub>6–8</sub> | 9 <sub>8–9</sub> | 9 <sub>8–10</sub> | 11 <sub>9–12</sub> |
| grounded | 9 <sub>9–13</sub> | 11 <sub>10–12</sub> | 11 <sub>10–11</sub> | 12 <sub>10–12</sub> |
| blockedButAnswered | 3 <sub>2–4</sub> | 4 <sub>3–4</sub> | 4 <sub>2–4</sub> | 5 <sub>5–7</sub> |
| honestRefusals | 6 <sub>5–6</sub> | 5 <sub>4–5</sub> | 4 <sub>3–5</sub> | 2 <sub>1–3</sub> |
| judgedOnCompleteData | 10 <sub>10</sub> | 14 <sub>14</sub> | 14 <sub>13–14</sub> | 14 <sub>14</sub> |
| totalTokens | 858797 <sub>852284–873954</sub> | 428239 <sub>415175–453652</sub> | 339940 <sub>311288–412358</sub> | 495754 <sub>477342–500885</sub> |

## Each phase against phase 0, and against the phase before it

| Metric | phase1 vs 0 | phase2 vs 0 | phase2 vs 1 | phase3 vs 0 | phase3 vs 2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| answered | +1 | +1 | 0 | +3 | +2 |
| grounded | +2 | +2 | 0 | +3 | +1 |
| blockedButAnswered | +1 | +1 | 0 | +2 | +1 |
| honestRefusals | -1 | -2 | -1 | -4 | -2 |
| judgedOnCompleteData | +4 | +4 | 0 | +4 | 0 |
| totalTokens | -430558 | -518857 | -88299 | -363043 | +155814 |

## Per task — runs that answered it

A task answered in every run is a capability. One answered in half of them is a coin
flip, and no single run can tell the two apart.

| Task | expected | phase0 | phase1 | phase2 | phase3 |
| --- | --- | :---: | :---: | :---: | :---: |
| lookup-geocode | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| lookup-route-summary | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| lookup-traffic-worst | pass | 2/3 | 3/3 | 3/3 | 3/3 |
| lookup-ev-availability | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| aggregate-incidents-by-road | blocked | 1/3 | 1/3 | 1/3 | 1/3 |
| aggregate-incidents-delay-total | blocked | 1/3 | 3/3 | 3/3 | 3/3 |
| aggregate-ev-connector-histogram | blocked | 1/3 | 0/3 | 2/3 | 3/3 |
| attributes-opening-hours | blocked | 2/3 | 1/3 | 1/3 | 1/3 |
| attributes-category-breakdown | blocked | 0/3 | 0/3 | 0/3 | 0/3 |
| geometry-turn-count | blocked | 3/3 | 3/3 | 3/3 | 3/3 |
| geometry-northernmost-point | blocked | 2/3 | 2/3 | 3/3 | 3/3 |
| cross-ev-within-range | blocked | 0/3 | 1/3 | 1/3 | 2/3 |
| cross-incidents-near-route | blocked | 0/3 | 1/3 | 0/3 | 2/3 |
| derive-fast-chargers-map | blocked | 1/3 | 2/3 | 1/3 | 2/3 |

## Tool selection

A scenario the target surface cannot express is excluded from the denominator rather
than counted as a failure — scoring a phase for not calling a tool it does not carry
would manufacture an improvement out of a tautology.

| Metric | phase0 | phase1 | phase2 | phase3 |
| --- | ---: | ---: | ---: | ---: |
| evaluated | 14 | 14 | 14 | 14 |
| not expressible | 0 | 0 | 0 | 0 |
| routed correctly | 12 | 14 | 14 | 14 |
| accuracy | 85.7% | 100.0% | 100.0% | 100.0% |
| mean hops | 1.79 | 1.14 | 1.14 | 1.14 |
| median hops | 1 | 1 | 1 | 1 |
| total tokens | 245,558 | 185,432 | 202,123 | 214,695 |

