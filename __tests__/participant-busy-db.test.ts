import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getPrisma } from "@/lib/db/client";
import type { TimeSlot } from "@/lib/types";
import {
  fetchBusyForUsers,
  MissingCalendarConnectionError,
} from "@/lib/calendar/participant-busy";

/**
 * The one thing `lib/calendar/participant-busy.test.ts` cannot check: that
 * `fetchBusyForUsers` actually reads `googleRefreshToken` off a real `User`
 * row rather than off a hand-built fixture. Same split, same reason, as
 * `__tests__/match-run-db.test.ts` next to `lib/db/match-run.test.ts`.
 *
 * **It skips itself when `DATABASE_URL` is unset**, which today is dev and CI
 * both:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/participant-busy-db.test.ts
 * ```
 *
 * `fetch` is still mocked here — nothing in this repo calls the real Google
 * Calendar API in a test. Only the database half is real.
 *
 * It seeds its own users under a run-specific prefix and deletes them
 * afterwards.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `b6c-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[participant-busy-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres; lib/calendar/participant-busy.test.ts covers the logic."
  );
}

const WINDOW: TimeSlot = {
  start: new Date("2026-09-07T06:00:00.000Z"),
  end: new Date("2026-09-08T06:00:00.000Z"),
};

function fakeResponse(ok: boolean, body: unknown) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

describe.skipIf(!CONNECTED)("fetchBusyForUsers against a real database", () => {
  const prisma = CONNECTED ? getPrisma() : null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return fakeResponse(true, { access_token: "tok-123" });
      }
      return fakeResponse(true, {
        calendars: {
          primary: {
            busy: [
              { start: "2026-09-07T09:00:00Z", end: "2026-09-07T10:00:00Z" },
            ],
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  it("reads the connected user's own refresh token off the database", async () => {
    if (!prisma) return;

    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-dana@example.test`,
        name: "Dana",
        googleId: `${PREFIX}-dana-google`,
        googleRefreshToken: "refresh-dana-real",
      },
    });

    const busy = await fetchBusyForUsers([user.id], WINDOW);

    expect(busy.get(user.id)).toEqual([
      {
        start: new Date("2026-09-07T09:00:00.000Z"),
        end: new Date("2026-09-07T10:00:00.000Z"),
      },
    ]);

    // The token that reached `fetch` came from the row just created, not a
    // fixture — this is the one thing the mocked-fetch suite cannot prove.
    const [, tokenInit] = fetchMock.mock.calls[0];
    const params = new URLSearchParams(tokenInit.body as string);
    expect(params.get("refresh_token")).toBe("refresh-dana-real");
  });

  it("raises MissingCalendarConnectionError for a user with no refresh token, before any network call", async () => {
    if (!prisma) return;

    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-yoav@example.test`,
        name: "Yoav",
        googleId: `${PREFIX}-yoav-google`,
        // No googleRefreshToken — never finished B2's sign-in with consent.
      },
    });

    await expect(fetchBusyForUsers([user.id], WINDOW)).rejects.toThrow(
      MissingCalendarConnectionError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
