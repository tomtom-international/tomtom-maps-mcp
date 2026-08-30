# Tool surface comparison

Baseline: `baseline` (/Users/daniel.forniessoria/IdeaProjects/tomtom-mcp-baseline)  
Current: `current`  
Model: gpt-5.1  
Generated: 2026-08-29T08:00:52.553Z

## Capability benchmark

Same tasks, same judge, same model, two servers.

| Metric | baseline | current | Δ |
| --- | ---: | ---: | ---: |
| answered | 7/13 | 11/13 | +4 |
| grounded | 9/13 | 11/13 | +2 |
| fabrication rate | 30.8% | 15.4% | -15.4pp |
| blocked-but-answered | 4/9 | 7/9 | +3 |
| honest refusals | 4/9 | 1/9 | -3 |
| total tokens | 706,958 | 272,567 | -434,391 |

> Honest refusals falling is not a regression on its own — a blocked task that
> becomes answerable stops being refused. Read it together with the row above it:
> refusals should fall by roughly what blocked-but-answered gains, and fabrication
> must stay at zero either way.

### Per task

| Task | Capability | answered | grounded | hops | tokens |
| --- | --- | :---: | :---: | ---: | ---: |
| lookup-geocode | lookup | ✓ | ✓ → **✗** | 1 → 1 | 15,312 → 13,862 |
| lookup-route-summary | lookup | ✓ | ✓ | 3 → 1 | 17,479 → 15,478 |
| lookup-traffic-worst | lookup | ✓ → **✗** | ✓ | 1 → 1 | 15,685 → 20,486 |
| lookup-ev-availability | lookup | ✗ → **✓** | ✗ → **✓** | 1 → 1 | 20,605 → 13,810 |
| aggregate-incidents-by-road | aggregate-at-scale | ✗ → **✓** | ✗ → **✓** | 1 → 2 | 123,739 → 25,819 |
| aggregate-incidents-delay-total | aggregate-at-scale | ✓ | ✓ | 1 → 2 | 95,256 → 25,712 |
| aggregate-ev-connector-histogram | aggregate-at-scale | ✗ | ✗ → **✓** | 1 → 2 | 51,047 → 14,389 |
| attributes-opening-hours | deep-attributes | ✓ | ✓ | 3 → 1 | 22,817 → 17,919 |
| attributes-category-breakdown | deep-attributes | ✗ → **✓** | ✓ | 2 → 8 | 15,676 → 36,751 |
| geometry-turn-count | route-geometry | ✓ | ✓ | 3 → 2 | 33,184 → 31,154 |
| geometry-northernmost-point | route-geometry | ✗ → **✓** | ✗ | 1 → 1 | 121,183 → 15,176 |
| cross-ev-within-range | cross-reference | ✗ → **✓** | ✓ | 3 → 3 | 84,119 → 14,181 |
| cross-incidents-near-route | cross-reference | ✓ | ✓ | 4 → 3 | 90,856 → 27,830 |

**Newly answerable:** lookup-ev-availability, aggregate-incidents-by-road, attributes-category-breakdown, cross-ev-within-range

**Lost:** lookup-traffic-worst

> A task the old surface answered and the new one does not is a regression the
> consolidation caused. It is not covered by the suite's own assertions unless the
> task is marked `expected: "pass"`.

## Tool selection

Same prompts, both surfaces. A baseline scenario passes when the agent picked any
of the legacy tools that were merged into the expected one (`harness/surfaces.ts`),
which is what makes the two runs comparable rather than a rename test.

| Metric | baseline | current | Δ |
| --- | ---: | ---: | ---: |
| evaluated | 28 | 28 | 0 |
| routed correctly | 23 | 27 | +4 |
| accuracy | 82.1% | 96.4% | +14.3pp |
| mean hops | 2.25 | 1.32 | -0.93 |
| median hops | 2 | 1 | -1 |
| total tokens | 642,502 | 449,042 | -193,460 |
| not expressible on this surface | 0 | 0 | — |
| retried attempts (excluded) | 24 | 14 | — |
| of which failed then passed | 1 | 0 | -1 |

> Scenario `describe`s set `retry: 2`, so a flaky prompt is attempted up to three
> times. Only the final attempt of each prompt/model pair is counted — otherwise the
> surface that fails more earns a bigger denominator, which is the thing being
> measured. The retry rows are the flakiness signal, not part of the accuracy.

### Prompts whose hop count moved

| Prompt | Model | baseline | current |
| --- | --- | ---: | ---: |
| Give me 10, 20 and 30-minute isochrones from Amsterdam Centraal | gpt-4.1 | 8 (tomtom-geocode → tomtom-reachable-range → tomtom-reachable-range → tomtom-reachable-range → tomtom-geocode → tomtom-reachable-range → tomtom-reachable-range → tomtom-reachable-range) | 1 (tomtom-find-reachable-areas) |
| Give me 10, 20 and 30-minute isochrones from Amsterdam Centraal | gpt-5.1 | 5 (tomtom-geocode → tomtom-geocode → tomtom-reachable-range → tomtom-reachable-range → tomtom-reachable-range) | 1 (tomtom-find-reachable-areas) |
| Route from Amsterdam Centraal to the Rijksmuseum | gpt-4.1 | 4 (tomtom-geocode → tomtom-geocode → tomtom-fuzzy-search → tomtom-routing) | 1 (tomtom-plan-route) |
| Any hold-ups on that route right now? | gpt-4.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-traffic) | 0 (none) |
| Route from Amsterdam Centraal to the Rijksmuseum | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Plan an EV route from Amsterdam to Munich with charging stops | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-ev-routing) | 1 (tomtom-plan-route) |
| Plan an EV route from Amsterdam to Munich with charging stops | gpt-4.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-ev-routing) | 1 (tomtom-plan-route) |
| How far can I drive from Amsterdam in 30 minutes? | gpt-5.1 | 2 (tomtom-geocode → tomtom-reachable-range) | 1 (tomtom-find-reachable-areas) |
| How far can I drive from Amsterdam in 30 minutes? | gpt-4.1 | 2 (tomtom-geocode → tomtom-reachable-range) | 1 (tomtom-find-reachable-areas) |
| Where can I stop for coffee on that drive? | gpt-5.1 | 3 (tomtom-poi-categories → tomtom-routing → tomtom-search-along-route) | 2 (tomtom-discover-places → tomtom-discover-places) |
| Where can I stop for coffee on that drive? | gpt-4.1 | 4 (tomtom-poi-categories → tomtom-geocode → tomtom-geocode → tomtom-search-along-route) | 3 (tomtom-discover-places → tomtom-poi-categories → tomtom-discover-places) |
| Any hold-ups on that route right now? | gpt-5.1 | 1 (tomtom-traffic) | 0 (none) |
| Find Italian restaurants in Amsterdam | gpt-4.1 | 2 (tomtom-poi-categories → tomtom-poi-search) | 3 (tomtom-discover-places → tomtom-poi-categories → tomtom-discover-places) |
| Get me the boundary of De Jordaan in Amsterdam | gpt-5.1 | 0 (none) | 1 (tomtom-locate-place) |

### Current-surface misroutes

- **Find Italian restaurants in Amsterdam** _(gpt-4.1)_ — Tool tomtom-poi-categories was called but should not have been.

