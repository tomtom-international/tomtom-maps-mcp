# Phase comparison

Model: gpt-5.1 · wiring: stdio · 3 capability run(s) per phase · generated 2026-09-03T09:26:16.498Z

Runs were interleaved (phase 0, 1, 2, 3 · phase 0, 1, 2, 3 · …) so drift in the live
APIs cannot land on one phase and read as a result. Capability figures are medians;
the range beside each is the spread across repeats, and a wide one means the metric
cannot separate these phases at this sample size.

## What each phase adds

| Phase | Adds | Model-visible tools |
| --- | --- | ---: |
| **2. Code execution, no state** | `analyse` — code over this call's own result | 9 |
| **3. Server-held datasets** | `dataset_id` handles + `describe-dataset` / `analyse-data` | 11 |

## Capability — medians

| Metric | phase2 (median) | phase3 (median) |
| --- | ---: | ---: |
| answered | 8 <sub>8–9</sub> | 10 <sub>9–10</sub> |
| grounded | 12 <sub>11–12</sub> | 12 <sub>10–13</sub> |
| blockedButAnswered | 4 <sub>4</sub> | 6 <sub>3–6</sub> |
| honestRefusals | 5 <sub>3–6</sub> | 4 <sub>2–4</sub> |
| judgedOnCompleteData | 14 <sub>14</sub> | 14 <sub>13–14</sub> |
| totalTokens | 331211 <sub>308721–331938</sub> | 556067 <sub>463870–574981</sub> |

## Each phase against phase 0, and against the phase before it

| Metric | phase3 vs 0 | phase3 vs 2 |
| --- | ---: | ---: |
| answered | +10 | +2 |
| grounded | +12 | 0 |
| blockedButAnswered | +6 | +2 |
| honestRefusals | +4 | -1 |
| judgedOnCompleteData | +14 | 0 |
| totalTokens | +556067 | +224856 |

## Per task — runs that answered it

A task answered in every run is a capability. One answered in half of them is a coin
flip, and no single run can tell the two apart.

| Task | expected | phase2 | phase3 |
| --- | --- | :---: | :---: |
| lookup-geocode | pass | 3/3 | 3/3 |
| lookup-route-summary | pass | 3/3 | 3/3 |
| lookup-traffic-worst | pass | 3/3 | 3/3 |
| lookup-ev-availability | pass | 3/3 | 3/3 |
| aggregate-incidents-by-road | blocked | 1/3 | 0/3 |
| aggregate-incidents-delay-total | blocked | 3/3 | 1/3 |
| aggregate-ev-connector-histogram | blocked | 2/3 | 3/3 |
| attributes-opening-hours | blocked | 1/3 | 1/3 |
| attributes-category-breakdown | blocked | 0/3 | 0/3 |
| geometry-turn-count | blocked | 2/3 | 2/3 |
| geometry-northernmost-point | blocked | 3/3 | 3/3 |
| cross-ev-within-range | blocked | 1/3 | 2/3 |
| cross-incidents-near-route | blocked | 0/3 | 2/3 |
| derive-fast-chargers-map | blocked | 0/3 | 3/3 |

