import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimeSlot } from "@/lib/types";
import { ExternalRateLimitError } from "@/lib/external/rate-limit";
import { CalendarAuthError, fetchBusy } from "./freebusy";

/**
 * No real network call ever leaves this file — `fetch` is replaced with a
 * mock for every test, and the two calls `fetchBusy` makes (token exchange,
 * then `freebusy.query`) are asserted against in sequence, the same way A1's
 * own tests keep the SDK itself out of scope and check the shape around it.
 */

const WINDOW: TimeSlot = {
  start: new Date("2026-09-07T06:00:00.000Z"),
  end: new Date("2026-09-08T06:00:00.000Z"),
};

/** A `Response`-shaped mock. Only what `fetchBusy` actually reads. */
function fakeResponse(
  ok: boolean,
  body: unknown,
  { asText = false }: { asText?: boolean } = {}
) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => (asText ? (body as string) : JSON.stringify(body)),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBusy", () => {
  it("exchanges the refresh token, then queries freebusy with the access token", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(true, { access_token: "tok-123" }))
      .mockResolvedValueOnce(
        fakeResponse(true, { calendars: { primary: { busy: [] } } })
      );

    await fetchBusy("refresh-abc", WINDOW);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(tokenInit.method).toBe("POST");
    const tokenBody = new URLSearchParams(tokenInit.body as string);
    expect(tokenBody.get("refresh_token")).toBe("refresh-abc");
    expect(tokenBody.get("grant_type")).toBe("refresh_token");

    const [freebusyUrl, freebusyInit] = fetchMock.mock.calls[1];
    expect(freebusyUrl).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(freebusyInit.headers.Authorization).toBe("Bearer tok-123");
    const freebusyBody = JSON.parse(freebusyInit.body as string);
    expect(freebusyBody.timeMin).toBe(WINDOW.start.toISOString());
    expect(freebusyBody.timeMax).toBe(WINDOW.end.toISOString());
    expect(freebusyBody.items).toEqual([{ id: "primary" }]);
  });

  it("converts each busy block to a TimeSlot", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(true, { access_token: "tok-123" }))
      .mockResolvedValueOnce(
        fakeResponse(true, {
          calendars: {
            primary: {
              busy: [
                {
                  start: "2026-09-07T09:00:00Z",
                  end: "2026-09-07T10:30:00Z",
                },
                {
                  start: "2026-09-07T14:00:00Z",
                  end: "2026-09-07T15:00:00Z",
                },
              ],
            },
          },
        })
      );

    const busy = await fetchBusy("refresh-abc", WINDOW);

    expect(busy).toEqual([
      {
        start: new Date("2026-09-07T09:00:00.000Z"),
        end: new Date("2026-09-07T10:30:00.000Z"),
      },
      {
        start: new Date("2026-09-07T14:00:00.000Z"),
        end: new Date("2026-09-07T15:00:00.000Z"),
      },
    ]);
  });

  it("is empty when the calendar has no busy blocks in the window", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(true, { access_token: "tok-123" }))
      .mockResolvedValueOnce(
        fakeResponse(true, { calendars: { primary: { busy: [] } } })
      );

    expect(await fetchBusy("refresh-abc", WINDOW)).toEqual([]);
  });

  it("is empty when the response omits busy entirely, not a crash", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(true, { access_token: "tok-123" }))
      .mockResolvedValueOnce(
        fakeResponse(true, { calendars: { primary: {} } })
      );

    expect(await fetchBusy("refresh-abc", WINDOW)).toEqual([]);
  });

  it("raises CalendarAuthError when the token exchange is rejected", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(false, "invalid_grant", { asText: true })
    );

    await expect(fetchBusy("revoked-token", WINDOW)).rejects.toThrow(
      CalendarAuthError
    );
    // Only the token call happens — a rejected exchange never reaches freebusy.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("raises CalendarAuthError when the token response carries no access_token", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(true, {}));

    await expect(fetchBusy("refresh-abc", WINDOW)).rejects.toThrow(
      CalendarAuthError
    );
  });

  it("raises a plain error, not CalendarAuthError, when freebusy.query itself fails", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(true, { access_token: "tok-123" }))
      .mockResolvedValueOnce(
        fakeResponse(false, "rate limited", { asText: true })
      );

    const failure = await fetchBusy("refresh-abc", WINDOW).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CalendarAuthError);
    expect((failure as Error).message).toMatch(/freebusy\.query failed/);
  });

  describe("B9 part four: rate limits", () => {
    /** A freebusy.query failure with a chosen status, body and headers. */
    function failure(status: number, body: string, retryAfter?: string) {
      return {
        ok: false,
        status,
        json: async () => body,
        text: async () => body,
        headers: {
          get: (name: string) =>
            name === "retry-after" ? (retryAfter ?? null) : null,
        },
      };
    }

    async function freebusyFailsWith(response: ReturnType<typeof failure>) {
      fetchMock
        .mockResolvedValueOnce(fakeResponse(true, { access_token: "tok-123" }))
        .mockResolvedValueOnce(response);
      return fetchBusy("refresh-abc", WINDOW).catch((error: unknown) => error);
    }

    it("throws ExternalRateLimitError on a 429, with Retry-After in ms", async () => {
      const error = await freebusyFailsWith(failure(429, "slow down", "45"));

      expect(error).toBeInstanceOf(ExternalRateLimitError);
      expect((error as ExternalRateLimitError).service).toBe("calendar");
      expect((error as ExternalRateLimitError).retryAfterMs).toBe(45_000);
      expect((error as Error).message).toMatch(
        /freebusy\.query failed \(429\)/
      );
    });

    it("leaves retryAfterMs null when a 429 sends no Retry-After", async () => {
      const error = await freebusyFailsWith(failure(429, "slow down"));

      expect((error as ExternalRateLimitError).retryAfterMs).toBeNull();
    });

    it.each(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"])(
      "treats a 403 naming %s as a rate limit",
      async (reason) => {
        const error = await freebusyFailsWith(
          failure(403, JSON.stringify({ error: { errors: [{ reason }] } }))
        );

        expect(error).toBeInstanceOf(ExternalRateLimitError);
      }
    );

    it("does not treat an ordinary 403 (a real permission problem) as a rate limit", async () => {
      const error = await freebusyFailsWith(
        failure(
          403,
          JSON.stringify({ error: { errors: [{ reason: "forbidden" }] } })
        )
      );

      expect(error).not.toBeInstanceOf(ExternalRateLimitError);
      expect(error).toBeInstanceOf(Error);
    });

    it("treats a token granted without the calendar scope as a consent problem", async () => {
      // The body Google sent in production (2026-10-06) when the calendar
      // box was left unticked at sign-in.
      const error = await freebusyFailsWith(
        failure(
          403,
          JSON.stringify({
            error: {
              code: 403,
              errors: [{ reason: "insufficientPermissions" }],
              status: "PERMISSION_DENIED",
              details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
            },
          })
        )
      );

      expect(error).toBeInstanceOf(CalendarAuthError);
      expect(error).not.toBeInstanceOf(ExternalRateLimitError);
    });

    it("does not treat a 500 as a rate limit", async () => {
      const error = await freebusyFailsWith(failure(500, "backend error"));

      expect(error).not.toBeInstanceOf(ExternalRateLimitError);
    });
  });

  it("B10: has no userId of its own -- this file never sees one", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(false, "invalid_grant", { asText: true })
    );

    const failure = await fetchBusy("revoked-token", WINDOW).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(CalendarAuthError);
    expect((failure as CalendarAuthError).userId).toBeUndefined();
  });
});
