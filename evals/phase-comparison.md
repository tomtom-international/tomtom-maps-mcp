# Phase comparison

Model: gpt-4.1 · wiring: stdio · 3 capability run(s) per phase · generated 2026-10-10T23:43:01.650Z

Runs were interleaved (phase 0, 1, 2, 3 · phase 0, 1, 2, 3 · …) so drift in the live
APIs cannot land on one phase and read as a result. Capability figures are medians;
the range beside each is the spread across repeats, and a wide one means the metric
cannot separate these phases at this sample size.

## What each phase adds

| Phase | Adds | Tools |
| --- | --- | --- |
| **0. Before the consolidation** | — |  |
| **1. Consolidated tools** | Fewer, wider tools — no new capability |  |

## Capability — medians

| Metric | phase0 (median) | phase1 (median) |
| --- | ---: | ---: |
| answered | 13 <sub>11–15</sub> | 14 <sub>13–14</sub> |
| grounded | 14 <sub>13–14</sub> | 16 <sub>14–16</sub> |
| blockedButAnswered | 7 <sub>6–7</sub> | 7 <sub>6–7</sub> |
| honestRefusals | 2 <sub>1–3</sub> | 2 <sub>2–3</sub> |
| judgedOnCompleteData | 11 <sub>11–13</sub> | 15 <sub>15–16</sub> |
| totalTokens | 550053 <sub>473273–624482</sub> | 458639 <sub>424290–538174</sub> |

## Each phase against phase 0, and against the phase before it

| Metric | phase1 vs 0 | phase1 vs 0 |
| --- | ---: | ---: |
| answered | +1 | +1 |
| grounded | +2 | +2 |
| blockedButAnswered | 0 | 0 |
| honestRefusals | 0 | 0 |
| judgedOnCompleteData | +4 | +4 |
| totalTokens | -91414 | -91414 |

## Per task — runs that answered it

A task answered in every run is a capability. One answered in half of them is a coin
flip, and no single run can tell the two apart.

| Task | expected | phase0 | phase1 |
| --- | --- | :---: | :---: |
| lookup-geocode | pass | 3/3 | 3/3 |
| lookup-route-summary | pass | 3/3 | 3/3 |
| lookup-traffic-worst | pass | 3/3 | 3/3 |
| lookup-along-route-detour | pass | 2/3 | 3/3 |
| lookup-neighbourhood-search | pass | 2/3 | 3/3 |
| lookup-along-route-order | pass | 2/3 | 3/3 |
| lookup-traffic-district | pass | 3/3 | 3/3 |
| aggregate-incidents-by-road | blocked | 1/3 | 1/3 |
| aggregate-incidents-delay-total | blocked | 3/3 | 3/3 |
| aggregate-ev-connector-histogram | blocked | 3/3 | 3/3 |
| attributes-opening-hours | blocked | 1/3 | 1/3 |
| attributes-category-breakdown | blocked | 1/3 | 0/3 |
| geometry-turn-count | blocked | 3/3 | 3/3 |
| geometry-northernmost-point | blocked | 3/3 | 2/3 |
| cross-ev-within-range | blocked | 3/3 | 3/3 |
| cross-incidents-near-route | blocked | 3/3 | 3/3 |
| lookup-ev-availability | blocked | 0/3 | 1/3 |
| derive-fast-chargers-map | blocked | 0/3 | 0/3 |

## Tool selection

A scenario the target surface cannot express is excluded from the denominator rather
than counted as a failure — scoring a phase for not calling a tool it does not carry
would manufacture an improvement out of a tautology.

| Metric | phase0 | phase1 |
| --- | ---: | ---: |
| evaluated | 46 | 46 |
| not expressible | 0 | 0 |
| routed correctly | 41 | 46 |
| accuracy | 89.1% | 100.0% |
| mean hops | 2.91 | 1.13 |
| median hops | 2 | 1 |
| total tokens | 816,140 | 635,087 |

