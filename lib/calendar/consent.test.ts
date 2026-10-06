import { describe, expect, it } from "vitest";

import { FREEBUSY_SCOPE, refreshTokenToStore } from "./consent";

describe("refreshTokenToStore", () => {
  it("stores no token when the calendar box was left unticked", () => {
    expect(
      refreshTokenToStore({
        scope: "openid https://www.googleapis.com/auth/userinfo.email",
        refresh_token: "rt-without-calendar",
      })
    ).toBeNull();
  });

  it("stores the token when the calendar was granted", () => {
    expect(
      refreshTokenToStore({
        scope: `openid ${FREEBUSY_SCOPE} email`,
        refresh_token: "rt",
      })
    ).toBe("rt");
  });

  it("leaves the stored token alone when Google sent no new one", () => {
    expect(refreshTokenToStore({ scope: FREEBUSY_SCOPE })).toBeUndefined();
  });

  it("does not read a missing scope list as a refusal", () => {
    expect(refreshTokenToStore({ refresh_token: "rt" })).toBe("rt");
  });
});
