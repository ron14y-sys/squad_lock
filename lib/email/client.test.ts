import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./client";

/**
 * Same discipline as `lib/places/client.test.ts` -- `fetch` is a mock
 * throughout, no real network call ever leaves this file.
 */

function fakeResponse(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM_ADDRESS", "SquadLock <noreply@squadlock.example>");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendEmail", () => {
  it("posts to Resend's send endpoint with the auth header, from address, and message", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { id: "email-1" }));

    const result = await sendEmail({
      to: "dana@example.test",
      subject: "Subject",
      html: "<p>Body</p>",
    });

    expect(result).toEqual({ id: "email-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: "SquadLock <noreply@squadlock.example>",
      to: "dana@example.test",
      subject: "Subject",
      html: "<p>Body</p>",
    });
  });

  it("throws with the status and body when Resend rejects the send", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(false, "invalid api key"));

    await expect(
      sendEmail({ to: "dana@example.test", subject: "s", html: "h" })
    ).rejects.toThrow(/send failed \(400\): invalid api key/);
  });

  it("throws before ever calling fetch when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(
      sendEmail({ to: "dana@example.test", subject: "s", html: "h" })
    ).rejects.toThrow(/RESEND_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws before ever calling fetch when RESEND_FROM_ADDRESS is unset", async () => {
    vi.stubEnv("RESEND_FROM_ADDRESS", "");

    await expect(
      sendEmail({ to: "dana@example.test", subject: "s", html: "h" })
    ).rejects.toThrow(/RESEND_FROM_ADDRESS is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
