import { describe, expect, it } from "vitest";

import { createGroupSchema, inviteToGroupSchema } from "./schema";

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

describe("inviteToGroupSchema", () => {
  it("normalises an email to lowercase and trims it", () => {
    const result = inviteToGroupSchema.safeParse({
      email: "  Dana@Example.COM  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("dana@example.com");
    }
  });

  it("rejects something that isn't an email address", () => {
    expect(
      inviteToGroupSchema.safeParse({ email: "not-an-email" }).success
    ).toBe(false);
  });

  it("rejects a missing email", () => {
    expect(inviteToGroupSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    const result = inviteToGroupSchema.safeParse({
      email: "dana@example.com",
      role: "admin",
    });

    expect(result.success).toBe(false);
  });
});
