import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calendarReconnectEmail,
  conflictReweighEmail,
  invitationEmail,
  meetingConfirmedEmail,
  proposalWaitingEmail,
  stuckEmail,
} from "./templates";

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

describe("invitationEmail", () => {
  it("links to the invitation token under APP_BASE_URL, and names the group and inviter", () => {
    const email = invitationEmail("Rothschild crew", "Dana", "tok-abc");

    expect(email.subject).toContain("Rothschild crew");
    expect(email.subject).toContain("Dana");
    expect(email.html).toContain(
      "https://squadlock.example/invitations/tok-abc"
    );
  });

  it("throws before building anything when APP_BASE_URL is unset", () => {
    vi.stubEnv("APP_BASE_URL", "");

    expect(() => invitationEmail("g", "Dana", "tok")).toThrow(
      /APP_BASE_URL is not set/
    );
  });
});

describe("meetingConfirmedEmail", () => {
  it("links to the meeting under APP_BASE_URL", () => {
    const email = meetingConfirmedEmail("meeting-1");

    expect(email.subject).toBeTruthy();
    expect(email.html).toContain(
      "https://squadlock.example/meetings/meeting-1"
    );
  });
});

describe("conflictReweighEmail", () => {
  it("links to the meeting under APP_BASE_URL", () => {
    const email = conflictReweighEmail("meeting-1");

    expect(email.subject).toBeTruthy();
    expect(email.html).toContain(
      "https://squadlock.example/meetings/meeting-1"
    );
  });
});

describe("stuckEmail", () => {
  it("links to the meeting under APP_BASE_URL", () => {
    const email = stuckEmail("meeting-1");

    expect(email.subject).toBeTruthy();
    expect(email.html).toContain(
      "https://squadlock.example/meetings/meeting-1"
    );
  });
});

describe("calendarReconnectEmail", () => {
  it("links to Auth.js's own sign-in route, not a meeting", () => {
    const email = calendarReconnectEmail();

    expect(email.subject).toBeTruthy();
    expect(email.html).toContain(
      "https://squadlock.example/api/auth/signin?callbackUrl=%2Fgroups"
    );
  });

  it("throws before building anything when APP_BASE_URL is unset", () => {
    vi.stubEnv("APP_BASE_URL", "");

    expect(() => calendarReconnectEmail()).toThrow(/APP_BASE_URL is not set/);
  });
});
