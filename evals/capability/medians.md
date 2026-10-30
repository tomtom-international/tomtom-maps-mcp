# Capability benchmark — median of repeated runs

Model: gpt-4.1 · wiring: stdio · generated 2026-10-28T12:57:49.307Z

Runs were interleaved (baseline, current, baseline, …) so drift in the live APIs
or the model endpoint cannot land on one surface and read as a result. Each run's
report is in `evals/capability/runs/2026-10-28T10-59-16-437Z/`.

## Medians — baseline over 3 runs, current over 3

| Metric | baseline median | baseline range | current median | current range | Δ median |
| --- | ---: | ---: | ---: | ---: | ---: |
| answered | 19 | 17–19 | 23 | 21–25 | +4 |
| grounded | 20 | 19–23 | 25 | 24–25 | +5 |
| blockedButAnswered | 5 | 3–5 | 6 | 5–7 | +1 |
| honestRefusals | 3 | 2–5 | 3 | 1–4 | 0 |
| judgedOnCompleteData | 18 | 17–19 | 26 | 26 | +8 |
| totalTokens | 1,138,743 | 1116800–1414100 | 671,451 | 659144–719880 | -467,292 |

## Per task — how many runs answered it

A task answered in every run is a capability; one answered in half of them is a
coin flip, and no single run can tell them apart.

| Task | expected | baseline answered | current answered | baseline grounded | current grounded |
| --- | --- | ---: | ---: | ---: | ---: |
| lookup-geocode | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| lookup-route-summary | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| lookup-traffic-worst | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| lookup-along-route-detour | pass | 3/3 | 2/3 | 3/3 | 3/3 |
| lookup-neighbourhood-search | pass | 1/3 | 2/3 | 1/3 | 3/3 |
| lookup-along-route-order | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| lookup-traffic-district | pass | 2/3 | 3/3 | 2/3 | 3/3 |
| aggregate-incidents-by-road | blocked | 0/3 | 3/3 | 0/3 | 3/3 |
| aggregate-incidents-delay-total | blocked | 3/3 | 3/3 | 2/3 | 3/3 |
| aggregate-ev-connector-histogram | blocked | 2/3 | 3/3 | 1/3 | 1/3 |
| attributes-opening-hours | blocked | 3/3 | 1/3 | 3/3 | 1/3 |
| attributes-category-breakdown | blocked | 0/3 | 1/3 | 3/3 | 3/3 |
| geometry-turn-count | blocked | 3/3 | 3/3 | 3/3 | 3/3 |
| geometry-northernmost-point | blocked | 1/3 | 3/3 | 1/3 | 3/3 |
| cross-ev-within-range | blocked | 2/3 | 3/3 | 3/3 | 3/3 |
| cross-incidents-near-route | blocked | 1/3 | 1/3 | 2/3 | 1/3 |
| lookup-ev-availability | blocked | 0/3 | 0/3 | 3/3 | 3/3 |
| derive-fast-chargers-map | blocked | 0/3 | 0/3 | 2/3 | 0/3 |
| route-alternatives-diff | pass | 2/3 | 3/3 | 2/3 | 3/3 |
| route-car-sick-curves | pass | 0/3 | 3/3 | 0/3 | 3/3 |
| route-motorbike-twisty | pass | 0/3 | 3/3 | 0/3 | 3/3 |
| route-per-country | pass | 3/3 | 2/3 | 3/3 | 2/3 |
| route-live-vs-usual | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| route-stop-order | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| route-where-after-hours | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| route-motorways-used | pass | 3/3 | 3/3 | 3/3 | 3/3 |
| route-first-jam-distance | pass | 2/3 | 3/3 | 2/3 | 3/3 |
| route-local-departure | pass | 3/3 | 3/3 | 2/3 | 3/3 |
