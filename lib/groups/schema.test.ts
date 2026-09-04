import { describe, expect, it } from "vitest";

import { createGroupSchema } from "./schema";

describe("createGroupSchema", () => {
  it("accepts a plain name", () => {
    expect(createGroupSchema.safeParse({ name: "Thursday crew" }).success).toBe(
      true
    );
  });

  it("rejects an empty name", () => {
    expect(createGroupSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    // .trim() runs before .min(1), so "   " must not slip through as non-empty.
    expect(createGroupSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(createGroupSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    const result = createGroupSchema.safeParse({
      name: "Thursday crew",
      memberCount: 5,
    });

    expect(result.success).toBe(false);
  });
});
