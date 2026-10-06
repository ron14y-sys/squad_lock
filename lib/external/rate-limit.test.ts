import { describe, expect, it } from "vitest";

import {
  ExternalRateLimitError,
  MAX_RETRY_AFTER_MS,
  parseRetryAfterMs,
  retryAfterMsOf,
} from "./rate-limit";

const NOW = new Date("2026-10-06T12:00:00Z");

describe("parseRetryAfterMs", () => {
  it("reads whole seconds", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
  });

  it("reads an HTTP date relative to now", () => {
    expect(parseRetryAfterMs("Tue, 06 Oct 2026 12:02:00 GMT", NOW)).toBe(
      120_000
    );
  });

  it.each([null, undefined, "", "soon", "-5", "0"])(
    "is null for %j",
    (header) => {
      expect(parseRetryAfterMs(header, NOW)).toBeNull();
    }
  );

  it("is null for a date already in the past", () => {
    expect(parseRetryAfterMs("Tue, 06 Oct 2026 11:00:00 GMT", NOW)).toBeNull();
  });

  it("caps an absurd value instead of parking a meeting for weeks", () => {
    expect(parseRetryAfterMs("99999999", NOW)).toBe(MAX_RETRY_AFTER_MS);
  });
});

describe("retryAfterMsOf", () => {
  it("reads the retry-after header off a response-shaped object", () => {
    const response = {
      headers: { get: (name: string) => (name === "retry-after" ? "7" : null) },
    };
    expect(retryAfterMsOf(response)).toBe(7_000);
  });

  it("tolerates a response with no headers at all (a bare test mock)", () => {
    expect(retryAfterMsOf({})).toBeNull();
  });
});

describe("ExternalRateLimitError", () => {
  it("carries the service and the service's own delay", () => {
    const error = new ExternalRateLimitError("places", "places: 429", 5_000);
    expect(error).toBeInstanceOf(Error);
    expect(error.service).toBe("places");
    expect(error.retryAfterMs).toBe(5_000);
    expect(error.message).toBe("places: 429");
  });
});
