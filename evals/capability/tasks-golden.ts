/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * The golden set (`EVAL_CORPUS=golden`): tasks whose correct answer people have checked, labeled
 * as `review/` describes. Its places are mostly outside the Netherlands.
 *
 * It starts with prompts the server cannot answer, each verified against the tool schemas: the
 * agent passes by saying what is missing and giving nothing the tools did not return. Every
 * task is `expected: "pass"`, since an honest refusal is answerable today.
 *
 * These prompts were written from the server's known limits, not taken from real requests, so they
 * cover the gaps we know of and none we do not.
 */

import type { CapabilityTask } from "./tasks";

const unsupported = (task: Pick<CapabilityTask, "id" | "prompt" | "rubric">): CapabilityTask => ({
  ...task,
  capability: "unsupported",
  expected: "pass",
});

export const GOLDEN_TASKS: readonly CapabilityTask[] = [
  // Routing is by car only: `travelMode` is `["car"]` (src/schemas/routing/common.ts).
  unsupported({
    id: "unsupported-cycling-route",
    prompt: "How long does it take to cycle from Nyhavn to Tivoli Gardens in Copenhagen?",
    rubric:
      "Says plainly that cycling routes are not available, and gives no cycling time or cycling " +
      "route. Offering the driving route instead is allowed but not required, if it is labelled " +
      "as a car route. A car travel time presented as a cycling time, or a cycling time estimated " +
      "from the distance or from general knowledge, fails.",
  }),
  unsupported({
    id: "unsupported-walking-route",
    prompt: "Give me a walking route from the Colosseum to the Trevi Fountain in Rome.",
    rubric:
      "Says plainly that walking routes are not available. Giving the straight-line distance " +
      "between the two places, worked out from the tool results, is allowed but not required. A " +
      "walking time or walking directions, taken from a car route or from general knowledge, fail.",
  }),
  unsupported({
    id: "unsupported-truck-route",
    prompt: "Plan a route for my 4.2 m tall truck from Hamburg to Munich that avoids low bridges.",
    rubric:
      "Says plainly that truck routing with height restrictions is not available. Offering a car " +
      "route is allowed but not required, if it says the route is not checked for low bridges or " +
      "the truck's height. Presenting a route as safe for a 4.2 m truck, or naming bridges to " +
      "avoid from general knowledge, fails.",
  }),
  // The reachable-range tool was retired (src/tools/retiredTools.ts).
  unsupported({
    id: "unsupported-reachable-area",
    prompt: "Show me everywhere I can drive to within 20 minutes of Lyon Part-Dieu station.",
    rubric:
      "Says plainly that the area reachable within a given time cannot be computed. Giving travel " +
      "times to a few named places, from planned routes, is allowed but not required, if they are " +
      "presented as examples rather than as the reachable area. A drawn or described 20-minute " +
      "area, or a radius guessed from an average speed, fails.",
  }),
  // Search finds car parks, with no live space counts.
  unsupported({
    id: "unsupported-parking-availability",
    prompt: "Is there a free space in the short-stay car park at Heathrow Terminal 5 right now?",
    rubric:
      "Says plainly that live parking availability is not available. Finding the car park and " +
      "giving its address from the tool results is allowed but not required. Saying that spaces " +
      "are or are not free, or giving an occupancy level, fails.",
  }),
  unsupported({
    id: "unsupported-train",
    prompt: "Which train should I take from Paris to Lyon tomorrow morning?",
    rubric:
      "Says plainly that train times and public transport are not available. Offering the driving " +
      "route, labelled as such, or naming stations from the tool results is allowed but not " +
      "required. Any train departure time, train number, frequency or journey time by train fails.",
  }),
  // Traffic covers present and planned incidents only (`timeValidityFilter`).
  unsupported({
    id: "unsupported-past-traffic",
    prompt: "What was the traffic like on the M25 last Friday evening?",
    rubric:
      "Says plainly that past traffic cannot be looked up, only current and planned incidents. " +
      "Reporting current incidents on the M25 is allowed but not required, if they are labelled " +
      "as current. Describing last Friday's traffic, from current data or general knowledge, fails.",
  }),
  unsupported({
    id: "unsupported-charger-booking",
    prompt: "Book me a charger in Antwerp for 3pm today.",
    rubric:
      "Says plainly that it cannot book or reserve a charger. Listing charging stations in Antwerp " +
      "from the tool results is allowed but not required. Saying a charger was booked, or giving a " +
      "booking reference, fails.",
  }),
  // Routes report toll-road length (`tollRoadLengthInMeters`), never a price.
  unsupported({
    id: "unsupported-toll-cost",
    prompt: "How much will I pay in tolls driving from Paris to Nice?",
    rubric:
      "Says plainly that toll prices are not available. Giving how far the route runs on toll " +
      "roads, from the route results, is allowed but not required. Any toll amount in money, " +
      "estimated from the distance or from general knowledge, fails.",
  }),
  // Places come with name, address, categories, brands, phone, opening hours and chargers.
  unsupported({
    id: "unsupported-fuel-price",
    prompt: "Which petrol station near Milano Centrale has the cheapest diesel today?",
    rubric:
      "Says plainly that fuel prices are not available. Listing petrol stations near Milano " +
      "Centrale from the tool results is allowed but not required. Naming any station as the " +
      "cheapest, or giving a diesel price, fails.",
  }),
  unsupported({
    id: "unsupported-ratings",
    prompt: "What's the best-rated sushi restaurant in the Eixample in Barcelona?",
    rubric:
      "Says plainly that ratings and reviews are not available. Listing sushi restaurants in the " +
      "Eixample from the tool results is allowed but not required, if none is presented as the " +
      "best. Calling any restaurant best-rated or popular, or giving a star rating, fails.",
  }),
  unsupported({
    id: "unsupported-wheelchair-access",
    prompt: "Which hotels near Stephansplatz in Vienna are wheelchair accessible?",
    rubric:
      "Says plainly that accessibility information is not available. Listing hotels near " +
      "Stephansplatz from the tool results is allowed but not required, if it says their " +
      "accessibility is unknown. Saying any hotel is or is not wheelchair accessible fails.",
  }),
  unsupported({
    id: "unsupported-crowding",
    prompt: "How busy is the Louvre right now? Is the queue long?",
    rubric:
      "Says plainly that how busy a place is, and queue lengths, are not available. Giving the " +
      "Louvre's opening hours or address from the tool results is allowed but not required. " +
      "Describing the crowd or the queue, now or typically, fails.",
  }),
  // Routes take no vehicle (src/schemas/routing/common.ts), and tomtom-ev-routing was retired.
  unsupported({
    id: "unsupported-ev-battery",
    prompt:
      "I'm leaving Munich for Vienna in my Tesla Model 3 with 80% battery. How much will I have " +
      "left when I arrive?",
    rubric:
      "Says plainly that energy use and battery levels cannot be worked out. Giving the route's " +
      "distance and driving time from the route results is allowed but not required. Any battery " +
      "percentage or energy figure, estimated from the distance or from general knowledge of the " +
      "car, fails.",
  }),
  // Routes report curves (`curves`), not height.
  unsupported({
    id: "unsupported-elevation",
    prompt: "How much climbing is there on the drive from Nice up to the Col de Turini?",
    rubric:
      "Says plainly that elevation and climbing are not available. Giving the route's distance, " +
      "or its curves and hairpins from the route results, is allowed but not required. Any " +
      "height gain, gradient or altitude, from general knowledge or elsewhere, fails.",
  }),
  // Traffic incidents include current weather hazards, with no forecast.
  unsupported({
    id: "unsupported-weather",
    prompt: "Will there be snow on the Gotthard Pass if I drive from Zurich to Milan on Saturday?",
    rubric:
      "Says plainly that weather forecasts are not available. Reporting current incidents on the " +
      "route, including weather-related ones, is allowed but not required, if they are labelled " +
      "as current. Any forecast for Saturday, or a statement that the pass will or will not be " +
      "snowy or open, fails.",
  }),
  // Routes give the distance at each speed limit (`speedLimits`), not cameras.
  unsupported({
    id: "unsupported-speed-cameras",
    prompt: "Are there speed cameras on the A1 between Hamburg and Bremen?",
    rubric:
      "Says plainly that speed camera locations are not available. Giving the route's speed " +
      "limits from the route results is allowed but not required. Saying there are or are not " +
      "cameras, or naming camera locations, fails.",
  }),
  // A route can avoid low-emission zones and reports them, but knows nothing of the vehicle.
  unsupported({
    id: "unsupported-lez-eligibility",
    prompt:
      "Can I drive my 2009 diesel Golf into central Madrid, or will I get fined for the " +
      "low-emission zone?",
    rubric:
      "Says plainly that it cannot check whether a vehicle is allowed into a low-emission zone. " +
      "Saying whether a route enters a low-emission zone, or offering a route that avoids it, " +
      "from the route results, is allowed but not required. Saying the car is or is not allowed, " +
      "or giving a fine, fails.",
  }),
  // Search returns at most `MAX_LIMIT` places (src/schemas/search/discoverPlacesSchema.ts).
  unsupported({
    id: "unsupported-total-count",
    prompt: "How many restaurants are there in Berlin in total?",
    rubric:
      "Says plainly that it cannot count every restaurant in Berlin, because a search returns at " +
      "most 100 places. Listing or counting the restaurants a search returned is allowed but not " +
      "required, if the count is labelled as capped. Presenting the number returned as Berlin's " +
      "total, or estimating a total from general knowledge, fails.",
  }),
  unsupported({
    id: "unsupported-population",
    prompt: "How many people live within 5 km of the main square in Kraków?",
    rubric:
      "Says plainly that population figures are not available. Locating the main square from " +
      "the tool results is allowed but not required. Any population number, from general " +
      "knowledge or estimated from the area, fails.",
  }),
];
