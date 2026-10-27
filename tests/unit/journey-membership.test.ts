/**
 * Putting people into journeys by hand and from the client's segmented lists
 * (27 Oct 2026), and the team's own accounts showing in Activity.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dueAt } from "../../server/journeys";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const DAY = 86_400_000;

describe("when a journey starts", () => {
  it("counts sign-up emails from when the person joined the journey", () => {
    const createdAt = new Date("2026-09-28T12:00:00Z");
    const journeyStartedAt = new Date("2026-10-27T12:00:00Z");
    expect(dueAt({ anchor: "signup", day: 0 }, { createdAt, freeAccessUntil: null, journeyStartedAt })).toEqual(journeyStartedAt);
    expect(dueAt({ anchor: "signup", day: 2 }, { createdAt, freeAccessUntil: null, journeyStartedAt }))
      .toEqual(new Date(journeyStartedAt.getTime() + 2 * DAY));
  });

  it("still counts from sign-up for everyone else", () => {
    const createdAt = new Date("2026-10-27T12:00:00Z");
    expect(dueAt({ anchor: "signup", day: 1 }, { createdAt, freeAccessUntil: null })).toEqual(new Date(createdAt.getTime() + DAY));
  });

  it("is the latest of joining MTRLZD, joining the journey and the journey being switched on", () => {
    expect(read("server/journeyStore.ts")).toMatch(/greatest\(u\.created_at, e\.enrolled_at, j\.enabled_at\) as journey_started_at/);
  });
});

describe("choosing someone's journey", () => {
  const store = read("server/journeyStore.ts");
  it("sticks: an admin's choice, including 'none', overrides the automatic one", () => {
    expect(store).toMatch(/update users set journey_segment = \$\{segment \?\? NO_JOURNEY\}/);
    expect(store).toMatch(/export const NO_JOURNEY = "none"/);
  });
  it("imports accounts only, never the team's own, and reports who has no account", () => {
    expect(store).toMatch(/if \(f\.is_admin\) \{ team\+\+; continue; \}/);
    expect(store).toMatch(/noAccount: missing\.length/);
  });
});

describe("the team in Activity", () => {
  const activity = read("server/activity.ts");
  it("lists team accounts, marked, and still leaves them out of the totals", () => {
    expect(activity).toMatch(/coalesce\(u\.is_admin, false\) as is_admin,\n\s+\(select count\(\*\) from videos v where v\.creator_id = u\.id\)::int as videos/);
    expect(activity).toMatch(/u\.created_at >= \$\{since\} and not u\.is_admin/);
  });
});
