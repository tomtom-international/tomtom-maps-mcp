# Tool surface comparison

Baseline: `baseline` (`../tomtom-mcp-baseline`)  
Current: `current`  
Model: gpt-4.1  
Judge: gpt-4.1  
Generated: 2026-10-28T13:37:58.813Z

## Capability benchmark

Same tasks, same judge, same model, two servers.

| Metric | baseline | current | Δ |
| --- | ---: | ---: | ---: |
| answered | 17/28 | 21/28 | +4 |
| grounded | 19/28 | 25/28 | +6 |
| fabrication rate | 32.1% | 10.7% | -21.4pp |
| blocked-but-answered | 5/11 | 6/11 | +1 |
| honest refusals | 3/11 | 4/11 | +1 |
| total tokens | 1,138,743 | 719,880 | -418,863 |

> Honest refusals falling is not a regression on its own — a blocked task that
> becomes answerable stops being refused. Read it together with the row above it:
> refusals should fall by roughly what blocked-but-answered gains, and fabrication
> must stay at zero either way.

### Per task

| Task | Capability | answered | grounded | hops | tokens |
| --- | --- | :---: | :---: | ---: | ---: |
| lookup-geocode | lookup | ✓ | ✓ | 1 → 1 | 12,541 → 10,991 |
| lookup-route-summary | lookup | ✓ | ✓ | 3 → 1 | 14,123 → 12,358 |
| lookup-traffic-worst | lookup | ✓ | ✓ | 1 → 1 | 12,613 → 10,904 |
| lookup-along-route-detour | lookup | ✓ | ✓ | 24 → 1 | 40,156 → 16,889 |
| lookup-neighbourhood-search | lookup | ✗ | ✗ → **✓** | 3 → 1 | 13,698 → 11,641 |
| lookup-along-route-order | lookup | ✓ | ✓ | 4 → 1 | 17,133 → 11,689 |
| lookup-traffic-district | lookup | ✗ → **✓** | ✗ → **✓** | 1 → 1 | 14,629 → 12,328 |
| aggregate-incidents-by-road | aggregate-at-scale | ✗ → **✓** | ✗ → **✓** | 1 → 1 | 39,620 → 98,533 |
| aggregate-incidents-delay-total | aggregate-at-scale | ✓ | ✓ | 1 → 1 | 32,021 → 25,255 |
| aggregate-ev-connector-histogram | aggregate-at-scale | ✗ → **✓** | ✗ → **✓** | 1 → 1 | 76,973 → 86,247 |
| attributes-opening-hours | deep-attributes | ✓ → **✗** | ✓ → **✗** | 3 → 1 | 24,884 → 14,327 |
| attributes-category-breakdown | deep-attributes | ✗ | ✓ | 2 → 1 | 12,678 → 10,775 |
| geometry-turn-count | route-geometry | ✓ | ✓ | 3 → 1 | 30,332 → 11,234 |
| geometry-northernmost-point | route-geometry | ✗ → **✓** | ✗ → **✓** | 3 → 2 | 25,892 → 120,127 |
| cross-ev-within-range | cross-reference | ✓ | ✓ | 5 → 2 | 36,135 → 11,425 |
| cross-incidents-near-route | cross-reference | ✓ → **✗** | ✓ | 4 → 3 | 63,666 → 11,390 |
| lookup-ev-availability | lookup | ✗ | ✓ | 0 → 1 | 12,399 → 15,334 |
| derive-fast-chargers-map | derive-and-draw | ✗ | ✗ | 3 → 2 | 25,623 → 86,645 |
| route-alternatives-diff | route-analysis | ✗ → **✓** | ✗ → **✓** | 3 → 1 | 16,655 → 16,844 |
| route-car-sick-curves | route-analysis | ✗ → **✓** | ✗ → **✓** | 3 → 1 | 46,392 → 13,774 |
| route-motorbike-twisty | route-analysis | ✗ → **✓** | ✗ → **✓** | 0 → 1 | 12,713 → 11,820 |
| route-per-country | route-analysis | ✓ → **✗** | ✓ → **✗** | 3 → 1 | 221,017 → 13,213 |
| route-live-vs-usual | route-analysis | ✓ | ✓ | 4 → 1 | 13,919 → 11,324 |
| route-stop-order | route-analysis | ✓ | ✓ | 6 → 1 | 14,330 → 11,651 |
| route-where-after-hours | route-analysis | ✓ | ✓ | 5 → 1 | 181,921 → 12,288 |
| route-motorways-used | route-analysis | ✓ | ✓ | 3 → 1 | 98,406 → 11,424 |
| route-first-jam-distance | route-analysis | ✓ | ✓ | 4 → 1 | 15,104 → 28,382 |
| route-local-departure | route-analysis | ✓ | ✓ | 3 → 1 | 13,170 → 11,068 |

**Newly answerable:** lookup-traffic-district, aggregate-incidents-by-road, aggregate-ev-connector-histogram, geometry-northernmost-point, route-alternatives-diff, route-car-sick-curves, route-motorbike-twisty

**Lost:** attributes-opening-hours, cross-incidents-near-route, route-per-country

> A task the old surface answered and the new one does not is a regression the
> consolidation caused. It is not covered by the suite's own assertions unless the
> task is marked `expected: "pass"`.

## Tool selection

Same prompts, both surfaces. A baseline scenario passes when the agent picked any
of the legacy tools that were merged into the expected one (`harness/surfaces.ts`),
which is what makes the two runs comparable rather than a rename test.

| Metric | baseline | current | Δ |
| --- | ---: | ---: | ---: |
| evaluated | 104 | 104 | 0 |
| routed correctly | 99 | 102 | +3 |
| accuracy | 95.2% | 98.1% | +2.9pp |
| mean hops | 2.47 | 1.13 | -1.34 |
| median hops | 2 | 1 | -1 |
| total tokens | 2,052,917 | 1,417,031 | -635,886 |
| not expressible on this surface | 0 | 0 | — |
| retried attempts (excluded) | 30 | 16 | — |
| of which failed then passed | 3 | 0 | -3 |

> Scenario `describe`s set `retry: 2`, so a flaky prompt is attempted up to three
> times. Only the final attempt of each prompt/model pair is counted — otherwise the
> surface that fails more earns a bigger denominator, which is the thing being
> measured. The retry rows are the flakiness signal, not part of the accuracy.

### Prompts whose hop count moved

| Prompt | Model | baseline | current |
| --- | --- | ---: | ---: |
| I'm driving from Utrecht to Eindhoven. Find a charging station I can reach with at most 10 extra minutes of driving. | gpt-4.1 | 10 (tomtom-geocode → tomtom-geocode → tomtom-routing → tomtom-poi-categories → tomtom-search-along-route → tomtom-routing → tomtom-routing → tomtom-routing → tomtom-routing → tomtom-routing) | 3 (tomtom-discover-places → tomtom-poi-categories → tomtom-discover-places) |
| I have to stop in Eindhoven, Utrecht and Den Bosch on the way from Amsterdam to Maastricht. In what order? | gpt-4.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| I have to stop in Eindhoven, Utrecht and Den Bosch on the way from Amsterdam to Maastricht. In what order? | gpt-5.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Driving from Paris to Barcelona, where will I be after four hours? | gpt-4.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-routing → tomtom-routing → tomtom-routing → tomtom-reverse-geocode) | 1 (tomtom-plan-route) |
| Plan Amsterdam to Maastricht with stops in Eindhoven, Utrecht and Den Bosch, in whatever order is quickest. | gpt-4.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Plan Amsterdam to Maastricht with stops in Eindhoven, Utrecht and Den Bosch, in whatever order is quickest. | gpt-5.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Driving from Paris to Barcelona, where will I be after two hours and after five hours? | gpt-4.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-routing → tomtom-routing → tomtom-reverse-geocode → tomtom-reverse-geocode) | 1 (tomtom-plan-route) |
| Which has more sushi restaurants, Rotterdam or The Hague? | gpt-4.1 | 7 (tomtom-poi-categories → tomtom-geocode → tomtom-geocode → tomtom-area-search → tomtom-area-search → tomtom-area-search → tomtom-area-search) | 2 (tomtom-discover-places → tomtom-discover-places) |
| Somewhere to eat on the way from Amsterdam to Brussels via Antwerp, 15 minutes detour max | gpt-5.1 | 6 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-poi-categories → tomtom-routing → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| Plan a drive from Utrecht to Maastricht via Eindhoven and Venlo | gpt-4.1 | 5 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Plan a drive from Utrecht to Maastricht via Eindhoven and Venlo | gpt-5.1 | 5 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Somewhere to eat on the way from Amsterdam to Brussels via Antwerp, 15 minutes detour max | gpt-4.1 | 5 (tomtom-geocode → tomtom-geocode → tomtom-geocode → tomtom-poi-categories → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| My passenger gets car sick. Which route from Grenoble to Briançon has the fewest sharp bends? | gpt-5.1 | 4 (tomtom-geocode → tomtom-geocode → tomtom-routing → tomtom-routing) | 1 (tomtom-plan-route) |
| Where can I stop for coffee on that drive? | gpt-4.1 | 4 (tomtom-poi-categories → tomtom-geocode → tomtom-geocode → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| Any hold-ups on that route right now? | gpt-4.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 0 (none) |
| Is the drive from Utrecht to Rotterdam taking a different way than usual today? | gpt-4.1 | 4 (tomtom-geocode → tomtom-geocode → tomtom-routing → tomtom-routing) | 1 (tomtom-plan-route) |
| Where can I stop for coffee on the drive from Amsterdam to Brussels? | gpt-4.1 | 4 (tomtom-geocode → tomtom-geocode → tomtom-poi-categories → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| Where can I stop for coffee on the drive from Amsterdam to Brussels? | gpt-5.1 | 4 (tomtom-poi-categories → tomtom-geocode → tomtom-geocode → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| Which has more sushi restaurants, Rotterdam or The Hague? | gpt-5.1 | 5 (tomtom-poi-categories → tomtom-fuzzy-search → tomtom-fuzzy-search → tomtom-area-search → tomtom-area-search) | 2 (tomtom-discover-places → tomtom-discover-places) |
| I'm driving from Utrecht to Eindhoven. Find a charging station I can reach with at most 10 extra minutes of driving. | gpt-5.1 | 4 (tomtom-poi-categories → tomtom-geocode → tomtom-geocode → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| List petrol stations in order along the drive from Lyon to Marseille, no more than 5 minutes off the route | gpt-4.1 | 4 (tomtom-geocode → tomtom-geocode → tomtom-poi-categories → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| How long does it take to drive from Paris to Lyon? | gpt-4.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| How long does it take to drive from Paris to Lyon? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Any hold-ups on the drive from Rotterdam to Amsterdam right now? | gpt-4.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Any hold-ups on the drive from Rotterdam to Amsterdam right now? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-search-along-route) | 1 (tomtom-plan-route) |
| Compare the route options from Amsterdam to Brussels: what does each one avoid? | gpt-4.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Compare the route options from Amsterdam to Brussels: what does each one avoid? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Driving from Paris to Barcelona, where will I be after four hours? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Where can I stop for coffee on that drive? | gpt-5.1 | 3 (tomtom-routing → tomtom-poi-categories → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| How many hairpin bends are on the road from Bormio to Merano over the Stelvio? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Is the drive from Utrecht to Rotterdam taking a different way than usual today? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-traffic) | 1 (tomtom-plan-route) |
| Driving from Paris to Barcelona, where will I be after two hours and after five hours? | gpt-5.1 | 3 (tomtom-geocode → tomtom-geocode → tomtom-routing) | 1 (tomtom-plan-route) |
| Find every bookshop inside Westminster | gpt-4.1 | 3 (tomtom-poi-categories → tomtom-fuzzy-search → tomtom-area-search) | 1 (tomtom-discover-places) |
| Show supermarkets within 500m of the station | gpt-4.1 | 3 (tomtom-fuzzy-search → tomtom-poi-categories → tomtom-nearby) | 1 (tomtom-discover-places) |
| Petrol stations within half a mile of Times Square | gpt-4.1 | 3 (tomtom-geocode → tomtom-poi-categories → tomtom-nearby) | 1 (tomtom-discover-places) |
| Petrol stations within half a mile of Times Square | gpt-5.1 | 3 (tomtom-geocode → tomtom-poi-categories → tomtom-nearby) | 1 (tomtom-discover-places) |
| Cosy cafés in De Pijp, Amsterdam | gpt-5.1 | 3 (tomtom-poi-categories → tomtom-fuzzy-search → tomtom-area-search) | 1 (tomtom-discover-places) |
| Find Albert Heijn supermarkets in Utrecht | gpt-4.1 | 3 (tomtom-poi-categories → tomtom-poi-search → tomtom-fuzzy-search) | 1 (tomtom-discover-places) |
| Route from Amsterdam Centraal to the Rijksmuseum | gpt-4.1 | 2 (tomtom-geocode → tomtom-geocode) | 1 (tomtom-plan-route) |
| Route from Amsterdam Centraal to the Rijksmuseum | gpt-5.1 | 2 (tomtom-geocode → tomtom-geocode) | 1 (tomtom-plan-route) |
| My passenger gets car sick. Which route from Grenoble to Briançon has the fewest sharp bends? | gpt-4.1 | 2 (tomtom-routing → tomtom-routing) | 1 (tomtom-plan-route) |
| Are there any road closures in Kreuzberg right now? | gpt-4.1 | 2 (tomtom-geocode → tomtom-traffic) | 1 (tomtom-get-traffic) |
| Any accidents within 3 km of Schiphol airport? | gpt-4.1 | 2 (tomtom-geocode → tomtom-traffic) | 1 (tomtom-get-traffic) |
| Any accidents within 3 km of Schiphol airport? | gpt-5.1 | 2 (tomtom-fuzzy-search → tomtom-traffic) | 1 (tomtom-get-traffic) |
| Find Italian restaurants in Amsterdam | gpt-4.1 | 2 (tomtom-poi-categories → tomtom-poi-search) | 1 (tomtom-discover-places) |
| Find Italian restaurants in Amsterdam | gpt-5.1 | 2 (tomtom-poi-categories → tomtom-poi-search) | 1 (tomtom-discover-places) |
| What's around 52.3791, 4.8994? | gpt-5.1 | 3 (tomtom-nearby → tomtom-poi-categories → tomtom-nearby) | 2 (tomtom-reverse-geocode → tomtom-discover-places) |
| Find every bookshop inside Westminster | gpt-5.1 | 2 (tomtom-poi-categories → tomtom-area-search) | 1 (tomtom-discover-places) |
| Find EV charging stations near Utrecht | gpt-4.1 | 2 (tomtom-geocode → tomtom-ev-search) | 1 (tomtom-discover-places) |
| Find EV charging stations near Utrecht | gpt-5.1 | 2 (tomtom-geocode → tomtom-ev-search) | 1 (tomtom-discover-places) |
| Get me the boundary of De Jordaan | gpt-4.1 | 2 (tomtom-fuzzy-search → tomtom-area-search) | 1 (tomtom-locate-place) |
| Get me the boundary of De Jordaan | gpt-5.1 | 2 (tomtom-fuzzy-search → tomtom-area-search) | 1 (tomtom-locate-place) |
| Find petrol stations within 2km of 52.3791, 4.8994 | gpt-4.1 | 2 (tomtom-poi-categories → tomtom-nearby) | 1 (tomtom-discover-places) |
| Get me the boundary of De Jordaan in Amsterdam | gpt-4.1 | 2 (tomtom-fuzzy-search → tomtom-area-search) | 1 (tomtom-locate-place) |
| Encuentra farmacias a menos de 300 metros de la Sagrada Família | gpt-5.1 | 3 (tomtom-geocode → tomtom-poi-categories → tomtom-area-search) | 2 (tomtom-discover-places → tomtom-discover-places) |
| Cosy cafés in De Pijp, Amsterdam | gpt-4.1 | 2 (tomtom-poi-categories → tomtom-fuzzy-search) | 1 (tomtom-discover-places) |
| Pubs in Cambridge, Massachusetts | gpt-4.1 | 2 (tomtom-poi-categories → tomtom-poi-search) | 1 (tomtom-discover-places) |
| Pubs in Cambridge, Massachusetts | gpt-5.1 | 2 (tomtom-poi-categories → tomtom-poi-search) | 1 (tomtom-discover-places) |
| Find Albert Heijn supermarkets in Utrecht | gpt-5.1 | 2 (tomtom-poi-categories → tomtom-poi-search) | 1 (tomtom-discover-places) |
| List petrol stations in order along the drive from Lyon to Marseille, no more than 5 minutes off the route | gpt-5.1 | 2 (tomtom-poi-categories → tomtom-search-along-route) | 1 (tomtom-discover-places) |
| Put a marker on the Eiffel Tower and outline the 1st arrondissement | gpt-5.1 | 2 (tomtom-geocode → tomtom-dynamic-map) | 3 (tomtom-locate-place → tomtom-locate-place → tomtom-dynamic-map) |
| What's around 52.3791, 4.8994? | gpt-4.1 | 2 (tomtom-poi-categories → tomtom-nearby) | 3 (tomtom-discover-places → tomtom-discover-places → tomtom-discover-places) |
| Show supermarkets within 500m of the station | gpt-5.1 | 0 (none) | 1 (tomtom-discover-places) |

### Current-surface misroutes

- **List petrol stations in order along the drive from Lyon to Marseille, no more than 5 minutes off the route** _(gpt-4.1)_ — tomtom-discover-places was called 1 time(s), none with matching arguments:
    [0] sortBy was not "detourOffset" — got {"poiCategories":["fuel station"],"where":{"mode":"maxDetour","locations":[{"query":"Lyon","queryAs":"place"},{"query":"Marseille","queryAs":"place"}],"maxDetourTimeSeconds":300},"limit":20}
- **List petrol stations in order along the drive from Lyon to Marseille, no more than 5 minutes off the route** _(gpt-5.1)_ — tomtom-discover-places was called 1 time(s), none with matching arguments:
    [0] sortBy was not "detourOffset" — got {"poiCategories":["FUEL_STATION"],"where":{"mode":"maxDetour","locations":[{"query":"Lyon, France","queryAs":"place"},{"query":"Marseille, France","queryAs":"place"}],"maxDetourTimeSeconds":300},"limit":20,"language":"en-GB","response_detail":"compact"}

