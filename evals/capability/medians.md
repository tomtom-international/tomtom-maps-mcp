# Capability benchmark — median of repeated runs

Model: gpt-5.1 · wiring: stdio · generated 2026-08-29T20:37:29.565Z

Runs were interleaved (baseline, current, baseline, …) so drift in the live APIs
or the model endpoint cannot land on one surface and read as a result. Each run's
report is in `evals/capability/runs/2026-08-29T19-54-46-680Z/`.

## Medians — baseline over 5 runs, current over 5

| Metric | baseline median | baseline range | current median | current range | Δ median |
| --- | ---: | ---: | ---: | ---: | ---: |
| answered | 6 | 6–7 | 10 | 8–13 | +4 |
| grounded | 9 | 8–10 | 10 | 10–13 | +1 |
| blockedButAnswered | 2 | 1–4 | 5 | 4–10 | +3 |
| honestRefusals | 4 | 4–6 | 1 | 0–3 | -3 |
| judgedOnCompleteData | 9 | 9–10 | 14 | 12–14 | +5 |
| totalTokens | 799,358 | 705829–878121 | 320,558 | 294358–443634 | -478,800 |

## Per task — how many runs answered it

A task answered in every run is a capability; one answered in half of them is a
coin flip, and no single run can tell them apart.

| Task | expected | baseline answered | current answered | baseline grounded | current grounded |
| --- | --- | ---: | ---: | ---: | ---: |
| lookup-geocode | pass | 5/5 | 5/5 | 5/5 | 5/5 |
| lookup-route-summary | pass | 2/5 | 5/5 | 2/5 | 5/5 |
| lookup-traffic-worst | pass | 5/5 | 5/5 | 4/5 | 5/5 |
| lookup-ev-availability | pass | 5/5 | 2/5 | 4/5 | 2/5 |
| aggregate-incidents-by-road | blocked | 0/5 | 5/5 | 1/5 | 5/5 |
| aggregate-incidents-delay-total | blocked | 1/5 | 4/5 | 2/5 | 5/5 |
| aggregate-ev-connector-histogram | blocked | 1/5 | 5/5 | 1/5 | 3/5 |
| attributes-opening-hours | blocked | 2/5 | 2/5 | 4/5 | 5/5 |
| attributes-category-breakdown | blocked | 1/5 | 2/5 | 5/5 | 4/5 |
| geometry-turn-count | blocked | 4/5 | 5/5 | 5/5 | 5/5 |
| geometry-northernmost-point | blocked | 0/5 | 3/5 | 0/5 | 2/5 |
| cross-ev-within-range | blocked | 0/5 | 4/5 | 5/5 | 3/5 |
| cross-incidents-near-route | blocked | 2/5 | 3/5 | 2/5 | 3/5 |
| derive-fast-chargers-map | blocked | 4/5 | 2/5 | 5/5 | 4/5 |
