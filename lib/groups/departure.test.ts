import { describe, expect, it } from "vitest";

import { LastMemberError, NotInGroupError, planDeparture } from "./departure";

const four = ["a", "b", "c", "d"];

describe("planDeparture", () => {
  it("keeps the admin and says somebody left when three or more stay", () => {
    expect(
      planDeparture({ memberIds: four, adminId: "a", leaverId: "d" })
    ).toEqual({
      remaining: ["a", "b", "c"],
      newAdminId: null,
      notice: "member_left",
      cancelOpenMeetings: false,
    });
  });

  it("hands the admin role to one of those who stay when the admin leaves", () => {
    const first = planDeparture({
      memberIds: four,
      adminId: "a",
      leaverId: "a",
      random: () => 0,
    });
    const last = planDeparture({
      memberIds: four,
      adminId: "a",
      leaverId: "a",
      random: () => 0.999,
    });

    expect(first.newAdminId).toBe("b");
    expect(last.newAdminId).toBe("d");
  });

  it("never picks the person who is leaving", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const plan = planDeparture({
        memberIds: four,
        adminId: "b",
        leaverId: "b",
        random: () => roll,
      });
      expect(plan.newAdminId).not.toBe("b");
      expect(plan.remaining).toContain(plan.newAdminId);
    }
  });

  it("makes someone admin if the group had none", () => {
    const plan = planDeparture({
      memberIds: four,
      adminId: null,
      leaverId: "d",
      random: () => 0,
    });

    expect(plan.newAdminId).toBe("a");
  });

  it("goes inactive and cancels open meetings when two are left", () => {
    expect(
      planDeparture({ memberIds: ["a", "b", "c"], adminId: "a", leaverId: "c" })
    ).toEqual({
      remaining: ["a", "b"],
      newAdminId: null,
      notice: "group_inactive",
      cancelOpenMeetings: true,
    });
  });

  it("is still inactive when one is left", () => {
    const plan = planDeparture({
      memberIds: ["a", "b"],
      adminId: "a",
      leaverId: "b",
    });

    expect(plan.remaining).toEqual(["a"]);
    expect(plan.notice).toBe("group_inactive");
  });

  it("does not let the last member leave", () => {
    expect(() =>
      planDeparture({ memberIds: ["a"], adminId: "a", leaverId: "a" })
    ).toThrow(LastMemberError);
  });

  it("does not let a stranger leave", () => {
    expect(() =>
      planDeparture({ memberIds: four, adminId: "a", leaverId: "z" })
    ).toThrow(NotInGroupError);
  });
});
