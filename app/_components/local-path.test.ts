import { describe, expect, it } from "vitest";

import { localPath } from "./local-path";

describe("localPath (#260)", () => {
  it("keeps a path on this site", () => {
    expect(localPath("/meetings/m1")).toBe("/meetings/m1");
  });

  it("refuses anything a browser would read as another site, and nothing", () => {
    for (const url of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "meetings/m1",
      "",
      null,
      undefined,
    ]) {
      expect(localPath(url)).toBeNull();
    }
  });
});
