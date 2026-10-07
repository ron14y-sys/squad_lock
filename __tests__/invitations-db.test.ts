import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { groupSizeWithPending } from "@/lib/db/groups";

/**
 * Manual test 4.4: inviting yourself, inviting an address that cannot get
 * mail, and no way to cancel an invitation. Both routes, against a real
 * database, because what matters is what the queries actually match: a
 * member who never had an invitation, an address in another case, a row
 * accepted a moment ago.
 *
 * Only the edges are faked: who is signed in, the email that would be sent,
 * `after()`, and DNS.
 *
 * **It skips itself when `DATABASE_URL` is unset** (dev and CI both), same
 * as the other `-db` suites. It seeds its own rows under a run-specific
 * prefix and deletes them afterwards.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `invitations-test-${Date.now()}`;

const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; email: string } },
}));
vi.mock("@/auth", () => ({ auth: async () => session.current }));

const notifyInvitation = vi.fn();
vi.mock("@/lib/email/notify", () => ({
  notifyInvitation: (...args: unknown[]) => notifyInvitation(...args),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

const domainAcceptsMail = vi.fn();
vi.mock("@/lib/email/mail-domain", () => ({
  domainAcceptsMail: (...args: unknown[]) => domainAcceptsMail(...args),
}));

const { POST } = await import("@/app/api/groups/[id]/invitations/route");
const { DELETE } =
  await import("@/app/api/groups/[id]/invitations/[invitationId]/route");

if (!CONNECTED) {
  console.info(
    "[invitations-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres."
  );
}

describe.skipIf(!CONNECTED)("invitations against a real database", () => {
  const prisma = CONNECTED ? getPrisma() : null;

  beforeEach(() => {
    notifyInvitation.mockReset();
    domainAcceptsMail.mockReset().mockResolvedValue(true);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  /** Two members who joined with no invitation — how a group's creator joins. */
  async function seed(tag: string) {
    if (!prisma) throw new Error("no prisma");
    const [dana, yoav] = await Promise.all(
      ["dana", "yoav"].map((name) =>
        prisma.user.create({
          data: {
            email: `${PREFIX}-${tag}-${name}@example.test`,
            name,
            googleId: `${PREFIX}-${tag}-${name}`,
          },
        })
      )
    );
    const group = await prisma.group.create({
      data: {
        name: `${PREFIX}-${tag}`,
        members: { create: [{ userId: dana!.id }, { userId: yoav!.id }] },
      },
    });
    session.current = { user: { id: dana!.id, email: dana!.email } };
    return { group, dana: dana!, yoav: yoav! };
  }

  function invite(groupId: string, email: string) {
    return POST(
      new Request("http://test/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
      { params: Promise.resolve({ id: groupId }) }
    );
  }

  function cancel(groupId: string, invitationId: string) {
    return DELETE(new Request("http://test/cancel", { method: "DELETE" }), {
      params: Promise.resolve({ id: groupId, invitationId }),
    });
  }

  function invitationsOf(groupId: string) {
    return prisma!.invitation.findMany({ where: { groupId } });
  }

  describe("inviting", () => {
    it("refuses your own address, with no invitation and no email", async () => {
      const { group, dana } = await seed("self");

      const res = await invite(group.id, dana.email.toUpperCase());

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "That is your own address." });
      expect(await invitationsOf(group.id)).toEqual([]);
      expect(notifyInvitation).not.toHaveBeenCalled();
    });

    it("refuses someone already in the group who never had an invitation", async () => {
      const { group, yoav } = await seed("member");

      const res = await invite(group.id, yoav.email);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "This person is already a member.",
      });
      expect(await invitationsOf(group.id)).toEqual([]);
    });

    it("refuses an address whose domain cannot receive mail", async () => {
      const { group } = await seed("domain");
      domainAcceptsMail.mockResolvedValue(false);

      const res = await invite(group.id, `${PREFIX}-x@gmail.con`);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "This address cannot receive email.",
      });
      expect(await invitationsOf(group.id)).toEqual([]);
      expect(notifyInvitation).not.toHaveBeenCalled();
    });

    it("still invites someone new, and emails them", async () => {
      const { group } = await seed("new");

      const res = await invite(group.id, `${PREFIX}-maya@example.test`);

      expect(res.status).toBe(201);
      const [row] = await invitationsOf(group.id);
      expect(row?.email).toBe(`${PREFIX}-maya@example.test`);
      expect(notifyInvitation).toHaveBeenCalledWith(row!.id);
    });
  });

  describe("cancelling", () => {
    async function pending(groupId: string, invitedById: string) {
      return prisma!.invitation.create({
        data: { groupId, email: `${PREFIX}-p-${groupId}@x.test`, invitedById },
      });
    }

    it("deletes a pending invitation and frees its place", async () => {
      const { group, dana } = await seed("cancel");
      const invitation = await pending(group.id, dana.id);
      expect(await groupSizeWithPending(prisma!, group.id)).toBe(3);

      const res = await cancel(group.id, invitation.id);

      expect(res.status).toBe(204);
      expect(await invitationsOf(group.id)).toEqual([]);
      expect(await groupSizeWithPending(prisma!, group.id)).toBe(2);
    });

    it("lets nobody outside the group cancel, and says the group is not found", async () => {
      const { group, dana } = await seed("outsider");
      const invitation = await pending(group.id, dana.id);
      const other = await seed("outsider-other");
      session.current = {
        user: { id: other.dana.id, email: other.dana.email },
      };

      const res = await cancel(group.id, invitation.id);

      expect(res.status).toBe(404);
      expect(await invitationsOf(group.id)).toHaveLength(1);
    });

    it("does not cancel an invitation that was already accepted", async () => {
      const { group, dana, yoav } = await seed("accepted");
      const invitation = await prisma!.invitation.create({
        data: {
          groupId: group.id,
          email: yoav.email,
          invitedById: dana.id,
          status: "accepted",
          acceptedByUserId: yoav.id,
        },
      });

      const res = await cancel(group.id, invitation.id);

      expect(res.status).toBe(409);
      expect(await invitationsOf(group.id)).toHaveLength(1);
    });

    it("does not reach an invitation of another group through this one", async () => {
      const { group, dana } = await seed("cross");
      const other = await seed("cross-other");
      const invitation = await pending(other.group.id, other.dana.id);
      // Dana is a member of her own group, not of the one the row is in.
      session.current = { user: { id: dana.id, email: dana.email } };

      const res = await cancel(group.id, invitation.id);

      expect(res.status).toBe(404);
      expect(await invitationsOf(other.group.id)).toHaveLength(1);
    });
  });
});
