import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proposalWaitingEmail } from "./templates";

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "https://squadlock.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proposalWaitingEmail", () => {
  it("links to the meeting under APP_BASE_URL", () => {
    const email = proposalWaitingEmail("meeting-1");

    expect(email.subject).toBeTruthy();
    expect(email.html).toContain(
      "https://squadlock.example/meetings/meeting-1"
    );
  });

  it("throws before building anything when APP_BASE_URL is unset", () => {
    vi.stubEnv("APP_BASE_URL", "");

    expect(() => proposalWaitingEmail("meeting-1")).toThrow(
      /APP_BASE_URL is not set/
    );
  });
});
