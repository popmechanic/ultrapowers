# Flock baseline: atlas through today's factory

**Grammar:** claims-v1

**Claim:** I open the merged pull request on flock-baseline and a list of places parses, loads, measures distances and bearings, plans a route, looks places up by country, name and size, prints them as a table, checks each place's position and country, and answers the list and dist commands, on a field now called population, with every check green. (elicited)
**Summary:** This runs fifteen atlas tasks at once for eight workers, across six modules and their tests, with three producer/consumer chains three deep, a rename that crosses six files, a pair of tasks that add a rule at the same spot in an order the merge would not choose, and nine tasks that can start at the first minute. It is the scale pass the operator asked for on 2026-09-25: one workload big enough for the laptop Flock and today's factory to separate, raced before any engine plan. You get the factory's numbers on it beside the swarm's, from the same task text and the same probes.

**Goal:** A like-for-like scale workload for map popmechanic/ultrapowers#1292 ticket 4: the atlas workload's fifteen tasks, with the prototype's own fact commands as each task's probes.

**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

**Base:** `atlas/__init__.py`, `atlas/places.py`, `atlas/geo.py`, `atlas/routes.py`, `atlas/index.py`, `atlas/render.py`, `atlas/validate.py`, `atlas/cli.py`, `tests/test_atlas_places.py`, `tests/test_atlas_geo.py` and `tests/test_atlas_render.py` exist at BASE, seeded by one commit on flock-baseline's main `520dd9d39c4f01700d0afa1ca770af0718b202f7` from `flock/proto/workloads.mjs` (the prototype's `ATLAS_SEED`) before this plan is launched. The seed touches no file that exists at `520dd9d3`.

Spec: popmechanic/ultrapowers#1292 (the Flock map) and its ticket 4 scale-pass comment.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider

---

### Task 1: Parse a place

**Type:** implementation

**Files:**
- Modify: `atlas/places.py`

**Claim:** An operator hands over a line describing a place and gets the place back, or a clear error when the line is malformed. (derived)
Machine: M1. `parse_place("Oslo;NO;59.91;10.75;709000")` equals `Place("Oslo", "NO", 59.91, 10.75, 709000)`. M2. `parse_place(" Bergen ; NO ; 60.39 ; 5.32 ; 285000 ")` equals `Place("Bergen", "NO", 60.39, 5.32, 285000)`. M3. `parse_place` of each of `"nope"`, `"Oslo;NO;x;10.75;1"`, `"Oslo;Norway;59.91;10.75;1"` and `"Oslo;NO;59.91;10.75;1;extra"` raises `ValueError` whose message is exactly `bad place`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `parse_place(line: str) -> Place`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; tasks 2 and 3 also edit `atlas/places.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write any new code against `population`, and leave the rename itself to task 3. `Place` has five fields in this order: `name`, `country`, `lat`, `lon`, and the head count (`pop`, becoming `population`). A line is exactly five fields separated by `;`, in that order, each stripped of surrounding spaces. The country is exactly two uppercase letters `A`–`Z`; `lat` and `lon` are read with `float`, the head count with `int`. A line with any other number of fields, a bad country or a field that does not read as its number is malformed. `parse_place` builds the `Place` positionally.

**Proof:**
- Run: python3 -c "from atlas.places import Place, parse_place; assert parse_place('Oslo;NO;59.91;10.75;709000') == Place('Oslo', 'NO', 59.91, 10.75, 709000)" [M1]
- Run: python3 -c "from atlas.places import Place, parse_place; assert parse_place(' Bergen ; NO ; 60.39 ; 5.32 ; 285000 ') == Place('Bergen', 'NO', 60.39, 5.32, 285000)" [M2]
- Run: python3 -c "import pytest; from atlas.places import parse_place; [pytest.raises(ValueError, parse_place, s).match('^bad place$') for s in ('nope', 'Oslo;NO;x;10.75;1', 'Oslo;Norway;59.91;10.75;1', 'Oslo;NO;59.91;10.75;1;extra')]" [M3]
- Legs: (a) the parsed place equals exactly `Place("Oslo", "NO", 59.91, 10.75, 709000)` [M1]; (b) spaces around every field are stripped [M2]; (c) each of the four malformed lines raises with the exact message, and a line that raised nothing fails the probe [M3].

**Stale-if:**
- path-absent: `atlas/places.py`

### Task 2: Load places

**Type:** implementation

**Files:**
- Modify: `atlas/places.py`

**Claim:** An operator loads a list of places from text, skipping blank lines and comment lines, and is told when a place appears twice. (derived)
Machine: M1. `load_places("Oslo;NO;59.91;10.75;709000\n\n# Norway\nBergen;NO;60.39;5.32;285000\n")` returns two places named `"Oslo"` and `"Bergen"`, in that order. M2. `load_places("Oslo;NO;1;2;3\nOslo;NO;4;5;6\n")` raises `ValueError` whose message is exactly `duplicate place Oslo`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `parse_place(line: str) -> Place`
- Produces: `load_places(text: str) -> list[Place]`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; tasks 1 and 3 also edit `atlas/places.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write any new code against `population`, and leave the rename itself to task 3. `load_places` parses, with `parse_place(line: str) -> Place` from task 1, every line that is not blank and does not start with `#` once stripped, and keeps the places in text order. A place is a repeat when the module's own `same_place(a, b)` (the same country and the same name) is true of it and an earlier place; a repeat raises `ValueError("duplicate place " + name)`.

**Proof:**
- Run: python3 -c "from atlas.places import load_places; ps = load_places('Oslo;NO;59.91;10.75;709000\n\n# Norway\nBergen;NO;60.39;5.32;285000\n'); assert [p.name for p in ps] == ['Oslo', 'Bergen']" [M1]
- Run: python3 -c "import pytest; from atlas.places import load_places; pytest.raises(ValueError, load_places, 'Oslo;NO;1;2;3\nOslo;NO;4;5;6\n').match('^duplicate place Oslo$')" [M2]
- Legs: (a) the blank and comment lines are skipped and the two places come back in order [M1]; (b) a repeated place raises with the exact message, and a load that raised nothing fails the probe [M2].

**Stale-if:**
- path-absent: `atlas/places.py`

### Task 3: Rename pop to population

**Type:** implementation

**Files:**
- Modify: `atlas/places.py`
- Modify: `atlas/index.py`
- Modify: `atlas/render.py`
- Modify: `atlas/validate.py`
- Modify: `tests/test_atlas_places.py`
- Modify: `tests/test_atlas_render.py`

**Claim:** Every place's head count is called its population, everywhere in the atlas and its tests, and everything that read it still works. (derived)
Machine: M1. No word `pop` that is not immediately followed by `(` remains in any `atlas/*.py` or `tests/test_atlas_*.py`. M2. `Place("Oslo", "NO", 59.91, 10.75, population=709000).population` is `709000`; over two such places `total_population` is `1418000`; `format_pop` of one is `"709k"`; `check_people` of a place whose population is `-1` is `"negative population"`; and `wrap("a bb ccc dddd", 6)` is still `["a bb", "ccc", "dddd"]`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `Place.population: int`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time, and several of them write new code against `population` while this task lands. Rename the `Place` field `pop` to `population` and every use of it: the dataclass in `atlas/places.py`, `total_population` in `atlas/index.py`, `format_pop` in `atlas/render.py`, `check_people` in `atlas/validate.py`, and the `pop=` keywords in `tests/test_atlas_places.py` and `tests/test_atlas_render.py`. Keep the function name `format_pop`. `wrap` in `atlas/render.py` calls the list method `words.pop(0)`, which is not the field and must stay as it is.

**Proof:**
- Run: python3 -c "import glob, re, sys; sys.exit(1 if any(re.search(r'\bpop\b(?!\()', open(f).read()) for f in glob.glob('atlas/*.py') + glob.glob('tests/test_atlas_*.py')) else 0)" [M1]
- Run: python3 -c "from atlas.places import Place; from atlas.index import total_population; from atlas.render import format_pop, wrap; from atlas.validate import check_people; o = Place('Oslo', 'NO', 59.91, 10.75, population=709000); assert o.population == 709000 and total_population([o, o]) == 1418000 and format_pop(o) == '709k' and check_people(Place('x', 'NO', 0, 0, population=-1)) == 'negative population' and wrap('a bb ccc dddd', 6) == ['a bb', 'ccc', 'dddd']" [M2]
- Legs: (a) the count of `pop` used as a name across the package and its tests is zero, and the method call `.pop(` is not counted [M1]; (b) the field reads as `population`, its three readers agree on it, and `wrap`'s `words.pop(0)` survived the rename [M2].

**Stale-if:**
- path-absent: `atlas/places.py`

### Task 4: Distance between two places

**Type:** implementation

**Files:**
- Modify: `atlas/geo.py`

**Claim:** An operator asks how far apart two places are and gets the great-circle distance in kilometres. (derived)
Machine: M1. For Oslo (59.91, 10.75) and Bergen (60.39, 5.32), `distance_km` is `305.1` both ways. M2. `distance_km` of a place and itself is `0.0`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `distance_km(a, b) -> float`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 5 also edits `atlas/geo.py`. `a` and `b` are `Place`s (read their `lat` and `lon`, in degrees); A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. Use the haversine formula with the module's own `EARTH_RADIUS_KM` and `radians(deg)`: with φ the latitudes and Δλ the difference in longitude, all in radians, h = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2), and the distance is 2 · R · asin(√h). Return it rounded to one decimal with `round(d, 1)`.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.geo import distance_km; o = S(lat=59.91, lon=10.75); b = S(lat=60.39, lon=5.32); assert distance_km(o, b) == 305.1 and distance_km(b, o) == 305.1" [M1]
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.geo import distance_km; o = S(lat=59.91, lon=10.75); assert distance_km(o, o) == 0.0" [M2]
- Legs: (a) the Oslo–Bergen distance, exactly, in both directions [M1]; (b) a place is no distance from itself [M2].

**Stale-if:**
- path-absent: `atlas/geo.py`

### Task 5: Bearing from one place to another

**Type:** implementation

**Files:**
- Modify: `atlas/geo.py`

**Claim:** An operator asks which way to set out from one place to reach another and gets a compass bearing from 0 up to 360 degrees. (derived)
Machine: M1. From (0, 0), `bearing_deg` to (10, 0) is `0.0` and to (0, 10) is `90.0`. M2. `bearing_deg` from (0, 10) to (0, 0) is `270.0`, and from (10, 0) to (0, 0) is `180.0`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `bearing_deg(a, b) -> float`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 4 also edits `atlas/geo.py`. `a` and `b` are `Place`s (read their `lat` and `lon`, in degrees); A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. With φ the latitudes and Δλ the difference in longitude, all in radians (the module's own `radians(deg)`), the bearing is atan2(sin Δλ · cos φ2, cos φ1 · sin φ2 − sin φ1 · cos φ2 · cos Δλ), turned into degrees with the module's own `degrees(rad)`, brought into 0 up to 360 with `(x + 360) % 360`, and rounded with `round(x, 1)`.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.geo import bearing_deg; P = lambda lat, lon: S(lat=lat, lon=lon); assert bearing_deg(P(0, 0), P(10, 0)) == 0.0 and bearing_deg(P(0, 0), P(0, 10)) == 90.0" [M1]
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.geo import bearing_deg; P = lambda lat, lon: S(lat=lat, lon=lon); assert bearing_deg(P(0, 10), P(0, 0)) == 270.0 and bearing_deg(P(10, 0), P(0, 0)) == 180.0" [M2]
- Legs: (a) due north and due east [M1]; (b) due west and due south, so a negative angle comes back inside 0 up to 360 [M2].

**Stale-if:**
- path-absent: `atlas/geo.py`

### Task 6: Route length and the nearest place

**Type:** implementation

**Files:**
- Modify: `atlas/routes.py`

**Claim:** An operator reads how long a route is and which place is closest to a given one. (derived)
Machine: M1. For Oslo (59.91, 10.75), Bergen (60.39, 5.32) and Stockholm (59.33, 18.07), `route_length([oslo, bergen, stockholm])` is `1025.5`, and `route_length` of one stop and of no stops is `0.0`. M2. `nearest(oslo, [stockholm, oslo, bergen])` is the place named `"Bergen"`, and `nearest(oslo, [oslo])` is `None`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `distance_km(a, b) -> float`
- Produces: `route_length(stops) -> float`
- Produces: `nearest(origin, places) -> Place | None`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 7 also edits `atlas/routes.py`. A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. `route_length` is the sum of `distance_km(a, b) -> float` (task 4) over each pair of consecutive stops, rounded with `round(x, 1)`; fewer than two stops is `0.0`. `nearest` answers the place in `places` with the smallest `distance_km` from `origin`, skipping any place for which the module's own `same_place(p, origin)` is true; on a tie the earlier place in `places` wins; with nothing left it answers `None`.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.routes import route_length; o = S(name='Oslo', country='NO', lat=59.91, lon=10.75); b = S(name='Bergen', country='NO', lat=60.39, lon=5.32); s = S(name='Stockholm', country='SE', lat=59.33, lon=18.07); assert route_length([o, b, s]) == 1025.5 and route_length([o]) == 0.0 and route_length([]) == 0.0" [M1]
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.routes import nearest; o = S(name='Oslo', country='NO', lat=59.91, lon=10.75); b = S(name='Bergen', country='NO', lat=60.39, lon=5.32); s = S(name='Stockholm', country='SE', lat=59.33, lon=18.07); assert nearest(o, [s, o, b]).name == 'Bergen' and nearest(o, [o]) is None" [M2]
- Legs: (a) a three-stop route's length, exactly, and the length of a route too short to have a leg [M1]; (b) the closest other place wins over the origin itself, and nothing left is `None` [M2].

**Stale-if:**
- path-absent: `atlas/routes.py`

### Task 7: Plan a route

**Type:** implementation

**Files:**
- Modify: `atlas/routes.py`

**Claim:** An operator plans a route from a starting place through the other places, each visited once, in the order the example below pins. (derived)
Machine: M1. From Oslo over Stockholm (59.33, 18.07), Bergen (60.39, 5.32), Uppsala (59.86, 17.64) and Oslo itself, `plan_route` visits `["Oslo", "Bergen", "Uppsala", "Stockholm"]`. M2. `plan_route(oslo, [])` is the route `["Oslo"]`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `nearest(origin, places) -> Place | None`
- Produces: `plan_route(start, places) -> list[Place]`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 6 also edits `atlas/routes.py`. A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. `plan_route` returns a list of places that begins with `start`; any place in `places` for which the module's own `same_place(p, start)` is true is not visited again. From the last place on the route it goes on to `nearest(origin, places) -> Place | None` (task 6) among the places not yet visited, until none are left.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.routes import plan_route; o = S(name='Oslo', country='NO', lat=59.91, lon=10.75); b = S(name='Bergen', country='NO', lat=60.39, lon=5.32); s = S(name='Stockholm', country='SE', lat=59.33, lon=18.07); u = S(name='Uppsala', country='SE', lat=59.86, lon=17.64); assert [p.name for p in plan_route(o, [s, b, u, o])] == ['Oslo', 'Bergen', 'Uppsala', 'Stockholm']" [M1]
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.routes import plan_route; o = S(name='Oslo', country='NO', lat=59.91, lon=10.75); assert [p.name for p in plan_route(o, [])] == ['Oslo']" [M2]
- Legs: (a) the four-place route, exactly and in order, with the start not visited twice [M1]; (b) a route with nowhere to go is the start alone [M2].

**Stale-if:**
- path-absent: `atlas/routes.py`

### Task 8: Places by country, and search by name

**Type:** implementation

**Files:**
- Modify: `atlas/index.py`

**Claim:** An operator sees every country's places, and finds places by the start of their name. (derived)
Machine: M1. `by_country([stockholm, bergen, oslo])` is `{"NO": ["Bergen", "Oslo"], "SE": ["Stockholm"]}`, with its keys in that order. M2. Over Stockholm (SE), Oslo (NO) and Stavanger (NO), `search(places, "st")` gives the places named `["Stavanger", "Stockholm"]`, in that order, and `search(places, "x")` is `[]`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `by_country(places) -> dict[str, list[str]]`
- Produces: `search(places, prefix: str) -> list[Place]`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; tasks 3 and 9 also edit `atlas/index.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write any new code against `population`, and leave the rename itself to task 3. A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. `by_country` maps each country code to the names of its places; both follow the module's own `sorted_places(places)` order (country, then name). `search` answers the places whose name starts with `prefix`, ignoring case, in `sorted_places` order.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.index import by_country; o = S(name='Oslo', country='NO'); b = S(name='Bergen', country='NO'); s = S(name='Stockholm', country='SE'); d = by_country([s, b, o]); assert d == {'NO': ['Bergen', 'Oslo'], 'SE': ['Stockholm']} and list(d) == ['NO', 'SE']" [M1]
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.index import search; ps = [S(name='Stockholm', country='SE'), S(name='Oslo', country='NO'), S(name='Stavanger', country='NO')]; assert [p.name for p in search(ps, 'st')] == ['Stavanger', 'Stockholm'] and search(ps, 'x') == []" [M2]
- Legs: (a) the grouping, the names' order and the countries' order [M1]; (b) a case-blind prefix match in country-then-name order, and no match is empty [M2].

**Stale-if:**
- path-absent: `atlas/index.py`

### Task 9: The largest places

**Type:** implementation

**Files:**
- Modify: `atlas/index.py`

**Claim:** An operator asks for the places where the most people live, biggest first. (derived)
Machine: M1. Over Oslo (709000), Bergen (NO, 285000), Stockholm (984000) and Aarhus (DK, 285000), `largest(places, 4)` gives the places named `["Stockholm", "Oslo", "Aarhus", "Bergen"]`, and `largest(places, 0)` is `[]`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `Place.population: int`
- Produces: `largest(places, n: int) -> list[Place]`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; tasks 3 and 8 also edit `atlas/index.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write `largest` against `place.population`, and leave the rename itself to task 3. `Place` is built positionally as `Place(name, country, lat, lon, population)`. `largest` answers at most `n` places, the largest population first; places with the same population follow the module's own `place_key` order (country, then name); `n` of `0` or less answers `[]`.

**Proof:**
- Run: python3 -c "from atlas.places import Place; from atlas.index import largest; ps = [Place('Oslo', 'NO', 59.91, 10.75, 709000), Place('Bergen', 'NO', 60.39, 5.32, 285000), Place('Stockholm', 'SE', 59.33, 18.07, 984000), Place('Aarhus', 'DK', 56.16, 10.2, 285000)]; assert [p.name for p in largest(ps, 4)] == ['Stockholm', 'Oslo', 'Aarhus', 'Bergen'] and largest(ps, 0) == []" [M1]
- Legs: (a) biggest first, the tie broken by country, and none asked for is empty [M1].

**Stale-if:**
- path-absent: `atlas/index.py`

### Task 10: Format a place

**Type:** implementation

**Files:**
- Modify: `atlas/render.py`

**Claim:** An operator reads one place as an aligned table row. (derived)
Machine: M1. `format_place(Place("Oslo", "NO", 59.91, 10.75, 709000))` is exactly `"Oslo (NO)              59.91    10.75     709,000"`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `Place.population: int`
- Produces: `format_place(place) -> str`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; tasks 3 and 11 also edit `atlas/render.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write `format_place` against `place.population`, and leave the rename itself to task 3. `Place` is built positionally as `Place(name, country, lat, lon, population)`. A row is the name, a space and the country code in parentheses, left-aligned in 20 columns; then `lat` with two decimals right-aligned in 8 columns; then `lon` with two decimals right-aligned in 9 columns; then the population with a comma between each group of three digits (`"{:,}".format(n)`) right-aligned in 12 columns. That is `"%-20s%8.2f%9.2f%12s"`.

**Proof:**
- Run: python3 -c "from atlas.places import Place; from atlas.render import format_place; assert format_place(Place('Oslo', 'NO', 59.91, 10.75, 709000)) == 'Oslo (NO)              59.91    10.75     709,000'" [M1]
- Legs: (a) the row, byte for byte [M1].

**Stale-if:**
- path-absent: `atlas/render.py`

### Task 11: A table of places

**Type:** implementation

**Files:**
- Modify: `atlas/render.py`

**Claim:** An operator prints a list of places as a table in country-then-name order, with the total population at the bottom. (derived)
Machine: M1. `table([stockholm, oslo])` is exactly the three lines `"Oslo (NO)              59.91    10.75     709,000"`, `"Stockholm (SE)         59.33    18.07     984,000"` and `"total                                   1,693,000"`, joined by newlines, with no trailing newline. M2. `table([])` is exactly `"total"` followed by 43 spaces and `"0"`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `format_place(place) -> str`
- Produces: `table(places) -> str`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; tasks 3 and 10 also edit `atlas/render.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write any new code against `population`, and leave the rename itself to task 3. A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. `table` formats every place with `format_place(place) -> str` (task 10), in the order of `sorted_places(places)` from `atlas/index.py`, and ends with a line that is `total` left-aligned in 37 columns followed by `total_population(places)` from `atlas/index.py`, with a comma between each group of three digits, right-aligned in 12 columns (`"%-37s%12s"`).

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.render import table; s = S(name='Stockholm', country='SE', lat=59.33, lon=18.07, population=984000); o = S(name='Oslo', country='NO', lat=59.91, lon=10.75, population=709000); assert table([s, o]) == 'Oslo (NO)              59.91    10.75     709,000\nStockholm (SE)         59.33    18.07     984,000\ntotal                                   1,693,000'" [M1]
- Run: python3 -c "from atlas.render import table; assert table([]) == 'total' + ' ' * 43 + '0'" [M2]
- Legs: (a) the three-line table, byte for byte, sorted and totalled, with no trailing newline [M1]; (b) an empty table is its total line alone [M2].

**Stale-if:**
- path-absent: `atlas/render.py`

### Task 12: Position rule

**Type:** implementation

**Files:**
- Modify: `atlas/validate.py`

**Claim:** A place whose position is off the globe is flagged. (derived)
Machine: M1. `check_range` answers `"bad position"` for a place at latitude 91 and for one at longitude −181, and `None` for one at (90, 180). M2. The first two names in `RULES` are `check_name`, `check_range`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `check_range(place) -> Optional[str]`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 13 edits the lines next to yours (the rule stubs and the `RULES` list), and task 3 also edits `atlas/validate.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write any new code against `population`, and leave the rename itself to task 3. A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. Implement `check_range`: `"bad position"` when `lat` is outside −90 to 90 or `lon` is outside −180 to 180 (both ends allowed), else `None`. Register `check_range` in `RULES` directly after `check_name`, so the order is `check_name`, `check_range`, then whatever task 13 adds, then `check_people`.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.validate import check_range; P = lambda lat, lon: S(lat=lat, lon=lon); assert check_range(P(91, 0)) == 'bad position' and check_range(P(0, -181)) == 'bad position' and check_range(P(90, 180)) is None" [M1]
- Run: python3 -c "from atlas.validate import RULES; assert [f.__name__ for f in RULES][:2] == ['check_name', 'check_range']" [M2]
- Legs: (a) a latitude and a longitude off the globe are flagged and the edge of the globe is not [M1]; (b) the first two rules, in order [M2].

**Stale-if:**
- path-absent: `atlas/validate.py`

### Task 13: Country rule

**Type:** implementation

**Files:**
- Modify: `atlas/validate.py`

**Claim:** A place whose country is not a two-letter code is flagged. (derived)
Machine: M1. `check_country` answers `"bad country"` for a place in `"no"` and for one in `"NOR"`, and `None` for one in `"NO"`. M2. The last two names in `RULES` are `check_country`, `check_people`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `check_country(place) -> Optional[str]`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 12 edits the lines next to yours (the rule stubs and the `RULES` list), and task 3 also edits `atlas/validate.py`. Task 3 renames the `Place` field `pop` to `population` everywhere; the final name is `population`, so write any new code against `population`, and leave the rename itself to task 3. A place is read by its attributes (`name`, `country`, `lat`, `lon` and the head count, `population`); the probes pass `types.SimpleNamespace` objects that carry only the attributes the function needs, so read attributes by name and never build or type-check a `Place`. Implement `check_country`: `"bad country"` unless the country is exactly two uppercase letters `A`–`Z`, else `None`. Register `check_country` in `RULES` directly before `check_people`, so the order is `check_name`, whatever task 12 adds, `check_country`, `check_people`.

**Proof:**
- Run: python3 -c "from types import SimpleNamespace as S; from atlas.validate import check_country; P = lambda c: S(country=c); assert check_country(P('no')) == 'bad country' and check_country(P('NOR')) == 'bad country' and check_country(P('NO')) is None" [M1]
- Run: python3 -c "from atlas.validate import RULES; assert [f.__name__ for f in RULES][-2:] == ['check_country', 'check_people']" [M2]
- Legs: (a) a lower-case code and a three-letter code are flagged and a good code is not [M1]; (b) the last two rules, in order [M2].

**Stale-if:**
- path-absent: `atlas/validate.py`

### Task 14: The list command

**Type:** implementation

**Files:**
- Modify: `atlas/cli.py`

**Claim:** An operator runs the list command over a text of places and gets the table. (derived)
Machine: M1. `main(["list"], "Stockholm;SE;59.33;18.07;984000\nOslo;NO;59.91;10.75;709000\n")` is exactly the three lines `"Oslo (NO)              59.91    10.75     709,000"`, `"Stockholm (SE)         59.33    18.07     984,000"` and `"total                                   1,693,000"`, joined by newlines.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `load_places(text: str) -> list[Place]`
- Consumes: `table(places) -> str`
- Produces: `cmd_list(args, places) -> str`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 15 also edits `atlas/cli.py` and adds its own command to `COMMANDS` beside yours (their order in `COMMANDS` does not matter). `main(argv, text)` already loads the places with `load_places(text: str) -> list[Place]` (task 2) and calls `COMMANDS[argv[0]](argv[1:], places)`. Add `cmd_list(args, places)`, which answers `table(places) -> str` from `atlas/render.py` (task 11), and register it in `COMMANDS` as `"list"`, keeping `"count"`.

**Proof:**
- Run: python3 -c "from atlas.cli import main; assert main(['list'], 'Stockholm;SE;59.33;18.07;984000\nOslo;NO;59.91;10.75;709000\n') == 'Oslo (NO)              59.91    10.75     709,000\nStockholm (SE)         59.33    18.07     984,000\ntotal                                   1,693,000'" [M1]
- Legs: (a) the command's output, byte for byte, from the text through to the table [M1].

**Stale-if:**
- path-absent: `atlas/cli.py`

### Task 15: The dist command

**Type:** implementation

**Files:**
- Modify: `atlas/cli.py`

**Claim:** An operator runs the dist command with two place names and gets the distance between them, or is told which name is unknown. (derived)
Machine: M1. Over the text `"Oslo;NO;59.91;10.75;709000\nBergen;NO;60.39;5.32;285000\n"`, `main(["dist", "Oslo", "Bergen"], text)` is `"305.1 km"`. M2. Over the same text, `main(["dist", "Oslo", "Paris"], text)` is `"unknown place Paris"`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4, scale pass (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `load_places(text: str) -> list[Place]`
- Consumes: `distance_km(a, b) -> float`
- Produces: `cmd_dist(args, places) -> str`

**Context:** Fifteen tasks of this plan edit the `atlas/` package at the same time; task 14 also edits `atlas/cli.py` and adds its own command to `COMMANDS` beside yours (their order in `COMMANDS` does not matter). `main(argv, text)` already loads the places with `load_places(text: str) -> list[Place]` (task 2) and calls `COMMANDS[argv[0]](argv[1:], places)`. Add `cmd_dist(args, places)`: `args` holds two place names; find the first place with each name, in order; if a name matches no place answer `"unknown place " + name` for the first such name; otherwise answer `distance_km(a, b) -> float` from `atlas/geo.py` (task 4) as `"%.1f km"`. Register it in `COMMANDS` as `"dist"`, keeping `"count"`.

**Proof:**
- Run: python3 -c "from atlas.cli import main; assert main(['dist', 'Oslo', 'Bergen'], 'Oslo;NO;59.91;10.75;709000\nBergen;NO;60.39;5.32;285000\n') == '305.1 km'" [M1]
- Run: python3 -c "from atlas.cli import main; assert main(['dist', 'Oslo', 'Paris'], 'Oslo;NO;59.91;10.75;709000\nBergen;NO;60.39;5.32;285000\n') == 'unknown place Paris'" [M2]
- Legs: (a) the distance, as the command prints it [M1]; (b) an unknown name is named back [M2].

**Stale-if:**
- path-absent: `atlas/cli.py`
