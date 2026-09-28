import { describe, expect, it } from "vitest";

import { membersLabel } from "./hebrew-labels";

describe("membersLabel", () => {
  it("uses the singular for one member, not '1 חברים'", () => {
    expect(membersLabel(1)).toBe("חבר אחד");
  });

  it("uses the plural with the number for any other count", () => {
    expect(membersLabel(2)).toBe("2 חברים");
    expect(membersLabel(0)).toBe("0 חברים");
    expect(membersLabel(12)).toBe("12 חברים");
  });
});
