import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { initiateMeeting } from "@/lib/db/meetings";
import { GROUP_SIZE_CAP, groupSizeWithPending } from "@/lib/db/groups";

/**
 * #174, spec §5.3 ("Groups of 3–6"). `lib/db/meetings.test.ts` cannot check
 * `initiateMeeting`'s new lower-bound throw — same reason as everything else
 * in that file's own comment: it is a transactional, DB-only function with
 * no injectable client. Same split, same reason, as
 * `__tests__/meetings-confirmation-db.test.ts` next to it.
 *
 * **It skips itself when `DATABASE_URL` is unset**, which today is dev and
 * CI both:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/group-size-db.test.ts
 * ```
 *
 * It seeds its own users and group under a run-specific prefix and deletes
 * them afterwards. It never touches a row it did not create.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `group-size-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[group-size-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres."
  );
}

describe.skipIf(!CONNECTED)("group size against a real database", () => {
  const prisma = CONNECTED ? getPrisma() : null;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  async function seedGroup(tag: string, memberCount: number) {
    if (!prisma) throw new Error("no prisma");

    const users = await Promise.all(
      Array.from({ length: memberCount }, (_, i) =>
        prisma.user.create({
          data: {
            email: `${PREFIX}-${tag}-${i}@example.test`,
            name: `Member ${i}`,
            googleId: `${PREFIX}-${tag}-${i}-google`,
          },
        })
      )
    );
    const group = await prisma.group.create({
      data: {
        name: `${PREFIX}-${tag}-group`,
        members: { create: users.map((u) => ({ userId: u.id })) },
      },
    });

    return { group, users };
  }

  it("refuses to open a meeting in a group of 2", async () => {
    const { group, users } = await seedGroup("too-small", 2);

    await expect(initiateMeeting(group.id, users[0]!.id, {})).rejects.toThrow(
      /has 2 members; a meeting needs at least 3/
    );
  });

  it("opens a meeting in a group of exactly 3", async () => {
    const { group, users } = await seedGroup("floor", 3);

    const meeting = await initiateMeeting(group.id, users[0]!.id, {});

    expect(meeting.groupId).toBe(group.id);
  });

  it("counts pending invitations toward the upper bound, through the real transaction", async () => {
    const { group, users } = await seedGroup("cap", 4);
    if (!prisma) throw new Error("no prisma");

    // 4 members + 2 pending invitations = 6, already at GROUP_SIZE_CAP.
    await prisma.invitation.createMany({
      data: [
        {
          groupId: group.id,
          email: `${PREFIX}-cap-pending-1@example.test`,
          invitedById: users[0]!.id,
        },
        {
          groupId: group.id,
          email: `${PREFIX}-cap-pending-2@example.test`,
          invitedById: users[0]!.id,
        },
      ],
    });

    const size = await prisma.$transaction((tx) =>
      groupSizeWithPending(tx, group.id)
    );

    expect(size).toBe(GROUP_SIZE_CAP);
  });
});
