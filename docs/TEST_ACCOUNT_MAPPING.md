# Test Account Mapping

Every seed account signs in with password `altair-fixture-pass`.

## Accounts

| Persona | Email | User id | Groups |
|---|---|---|---|
| Avery Lin | avery@example.test | `a1000000-0000-4000-8000-000000000001` | Maple |
| Jordan Price | jordan@example.test | `a1000000-0000-4000-8000-000000000002` | Maple |
| Sam Okafor | sam@example.test | `a1000000-0000-4000-8000-000000000003` | Maple |
| Riley Chen | riley@example.test | `a1000000-0000-4000-8000-000000000004` | Maple **and** Riverside |
| Morgan Ellis | morgan@example.test | `a1000000-0000-4000-8000-000000000005` | Riverside |
| Casey Moreno | casey@example.test | `a1000000-0000-4000-8000-000000000006` | Riverside |
| Taylor Brooks | taylor@example.test | `a1000000-0000-4000-8000-000000000007` | none (outsider) |
| Quinn Adler | quinn@example.test | `a1000000-0000-4000-8000-000000000008` | Riverside |

Note: Taylor is `…007` and Quinn is `…008` (not in alphabetical/table order).

## Groups

| Group | Id |
|---|---|
| Maple Street Walkers | `b2000000-0000-4000-8000-000000000001` |
| Riverside Loop Walkers | `b2000000-0000-4000-8000-000000000002` |

## Reference meetups (seed PART 2)

| Meetup | Id | Group | Creator | Start | Meeting point | RSVPs |
|---|---|---|---|---|---|---|
| Saturday morning loop | `c3…001` | Maple | Avery | +7 days | North gate, Linden Park (40.012046, -99.984517) | Jordan, Riley |
| Weeknight short walk | `c3…002` | Maple | Jordan | +10 days | Front steps, Elm Avenue Library (40.003318, -99.979762) | none |
| Riverside sunrise walk | `c3…003` | Riverside | Morgan | +8 days | Boathouse lot, Riverside Path (39.985239, -100.009683) | Casey |

Spare public place for created meetups: Fountain plaza, Town Green (39.999134, -99.999461).

## The four required test identities (against "Saturday morning loop")

| Required role | Persona | Why |
|---|---|---|
| Outsider | **Taylor** | In no group |
| Member, not RSVP'd | **Sam** | Maple member, no RSVPs |
| Member, RSVP'd | **Jordan** | RSVP'd to Saturday morning loop |
| Creator | **Avery** | Created Saturday morning loop |

Secondary checks: Morgan / Casey / Quinn are outsiders *to Maple* (a group-scoped outsider is different
from a no-group outsider); Quinn is the Riverside not-RSVP'd member.

## Multi-group case (Riley)

| Meetup | Riley's role | Expected meeting-point view |
|---|---|---|
| Saturday morning loop (Maple) | RSVP'd | exact |
| Weeknight short walk (Maple) | member, not RSVP'd | per product decision |
| Riverside sunrise walk (Riverside) | member, not RSVP'd | per product decision |

Proves: Riley sees both groups' meetups; the RSVP to Saturday morning loop grants nothing for the other
two; Riley's "my groups" returns exactly two groups.

## Private home locations (must never appear in any response)

| Persona | home_lat | home_lng |
|---|---|---|
| Avery | 40.004812 | -99.993127 |
| Jordan | 40.007395 | -99.988640 |
| Sam | 39.998263 | -99.995418 |
| Riley | 40.002957 | -100.006284 |
| Morgan | 39.993481 | -100.011736 |
| Casey | 39.989624 | -100.004952 |
| Taylor | 40.010538 | -100.014867 |
| Quinn | 39.996107 | -100.017392 |

Tests will scan every response body for these values (and for the keys `home_lat` / `home_lng`).
