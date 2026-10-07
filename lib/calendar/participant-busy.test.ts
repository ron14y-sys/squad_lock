import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimeSlot } from "@/lib/types";
import { CalendarAuthError } from "./freebusy";
import {
  fetchBusyForConnections,
  type CalendarConnection,
} from "./participant-busy";

/**
 * No database anywhere near this file — `fetchBusyForConnections` is the
 * logic, exercised entirely through a mocked `fetch`. The database round
 * trip (`fetchBusyForUsers`, which looks connections up before delegating
 * here) is `__tests__/participant-busy-db.test.ts`, same split as
 * `lib/db/match-run.ts` and its own `-db` counterpart.
 */

const WINDOW: TimeSlot = {
  start: new Date("2026-09-07T06:00:00.000Z"),
  end: new Date("2026-09-08T06:00:00.000Z"),
};

function fakeResponse(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const BUSY_BY_REFRESH_TOKEN: Record<string, { start: string; end: string }[]> =
  {
    "refresh-dana": [
      { start: "2026-09-07T09:00:00Z", end: "2026-09-07T10:00:00Z" },
    ],
    "refresh-yoav": [
      { start: "2026-09-07T14:00:00Z", end: "2026-09-07T15:00:00Z" },
    ],
  };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A single implementation that inspects each request, rather than a queue
  // of canned responses — `Promise.all` over several connections does not
  // guarantee the two calls per connection interleave in list order, so
  // matching on request content is what keeps this deterministic.
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(init.body as string);
      const refreshToken = params.get("refresh_token") ?? "";
      return fakeResponse(true, { access_token: `tok-${refreshToken}` });
    }
    if (url === "https://www.googleapis.com/calendar/v3/freeBusy") {
      const auth = (init.headers as Record<string, string>).Authorization;
      const refreshToken = auth.replace("Bearer tok-", "");
      return fakeResponse(true, {
        calendars: {
          primary: { busy: BUSY_BY_REFRESH_TOKEN[refreshToken] ?? [] },
        },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBusyForConnections", () => {
  it("fetches busy blocks for each connection, keyed by userId", async () => {
    const connections: CalendarConnection[] = [
      { userId: "u-dana", googleRefreshToken: "refresh-dana" },
      { userId: "u-yoav", googleRefreshToken: "refresh-yoav" },
    ];

    const { busy, unread } = await fetchBusyForConnections(connections, WINDOW);

    expect(unread).toEqual([]);
    expect(busy.get("u-dana")).toEqual([
      {
        start: new Date("2026-09-07T09:00:00.000Z"),
        end: new Date("2026-09-07T10:00:00.000Z"),
      },
    ]);
    expect(busy.get("u-yoav")).toEqual([
      {
        start: new Date("2026-09-07T14:00:00.000Z"),
        end: new Date("2026-09-07T15:00:00.000Z"),
      },
    ]);
  });

  it("is empty, with no network calls at all, for no connections", async () => {
    expect(await fetchBusyForConnections([], WINDOW)).toEqual({
      busy: new Map(),
      unread: [],
      rejected: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads everyone else when one person has no calendar connected", async () => {
    const connections: CalendarConnection[] = [
      { userId: "u-dana", googleRefreshToken: "refresh-dana" },
      { userId: "u-yoav", googleRefreshToken: null },
    ];

    const read = await fetchBusyForConnections(connections, WINDOW);

    // Yoav is reported, not fatal: Dana's calendar is still read, and Yoav
    // is simply absent from `busy` — free, as far as the calendar goes.
    expect(read.unread).toEqual(["u-yoav"]);
    expect(read.rejected).toEqual([]);
    expect(read.busy.has("u-yoav")).toBe(false);
    expect(read.busy.get("u-dana")).toHaveLength(1);
    // Two calls (token + freebusy) for Dana, none for Yoav.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("B10: reports a refused token as unread and rejected, and reads the rest", async () => {
    fetchMock.mockImplementationOnce(async () =>
      fakeResponse(false, "invalid_grant")
    );

    const connections: CalendarConnection[] = [
      { userId: "u-dana", googleRefreshToken: "revoked-token" },
      { userId: "u-yoav", googleRefreshToken: "refresh-yoav" },
    ];

    const read = await fetchBusyForConnections(connections, WINDOW);

    expect(read.unread).toEqual(["u-dana"]);
    expect(read.rejected).toEqual(["u-dana"]);
    expect(read.busy.get("u-yoav")).toHaveLength(1);
  });

  it("still fails whole on anything that is not a refused token", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "https://oauth2.googleapis.com/token"
        ? fakeResponse(true, { access_token: "tok" })
        : { ...fakeResponse(false, "backend error"), status: 500 }
    );

    const connections: CalendarConnection[] = [
      { userId: "u-dana", googleRefreshToken: "refresh-dana" },
    ];

    const failure = await fetchBusyForConnections(connections, WINDOW).catch(
      (error: unknown) => error
    );

    // An outage says nothing about whether Dana is free — no guessing.
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CalendarAuthError);
  });
});
