"use client";

import { useEffect, useState } from "react";

type GroupMember = {
  userId: string;
  joinedAt: string;
  user: { name: string; email: string };
};

type Group = {
  id: string;
  name: string;
  members: GroupMember[];
};

type Invitation = {
  id: string;
  email: string;
  status: "pending" | "accepted";
  createdAt: string;
};

type LoadState = "loading" | "ready" | "signed-out" | "not-found" | "error";

const KNOWN_INVITE_ERRORS: Record<string, string> = {
  "This person is already a member.": "האדם הזה כבר חבר בקבוצה.",
  "Group not found.": "הקבוצה הזו לא נמצאה.",
  "Invalid invitation.": "כתובת האימייל לא תקינה.",
};

export function GroupDetail({ groupId }: { groupId: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [group, setGroup] = useState<Group | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  function load() {
    Promise.all([
      fetch("/api/groups").then((res) => {
        if (res.status === 401) return { signedOut: true } as const;
        if (!res.ok) throw new Error(`GET /api/groups: ${res.status}`);
        return res.json();
      }),
      fetch(`/api/groups/${groupId}/invitations`).then((res) => {
        if (res.status === 401) return { signedOut: true } as const;
        if (res.status === 404) return { notFound: true } as const;
        if (!res.ok)
          throw new Error(
            `GET /api/groups/${groupId}/invitations: ${res.status}`
          );
        return res.json();
      }),
    ])
      .then(([groups, invitationsResult]) => {
        if ("signedOut" in groups || "signedOut" in invitationsResult) {
          setLoadState("signed-out");
          return;
        }
        if ("notFound" in invitationsResult) {
          setLoadState("not-found");
          return;
        }
        const found = (groups as Group[]).find((g) => g.id === groupId);
        if (!found) {
          setLoadState("not-found");
          return;
        }
        setGroup(found);
        setInvitations(invitationsResult as Invitation[]);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }

  useEffect(load, [groupId]);

  async function invite() {
    const trimmed = email.trim();
    if (!trimmed) return;

    setInviting(true);
    setInviteMessage(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setInviteMessage(
          KNOWN_INVITE_ERRORS[body.error] ?? "לא הצלחנו לשלוח את ההזמנה."
        );
        return;
      }
      setEmail("");
      setInviteMessage("ההזמנה נשלחה.");
      load();
    } catch {
      setInviteMessage("לא הצלחנו לשלוח את ההזמנה. נסה שוב.");
    } finally {
      setInviting(false);
    }
  }

  if (loadState === "loading") {
    return <p className="p-6 text-sm text-zinc-500">טוען את הקבוצה…</p>;
  }

  if (loadState === "signed-out") {
    return (
      <p className="p-6 text-sm text-zinc-500">התחבר כדי לראות את הקבוצה.</p>
    );
  }

  if (loadState === "not-found") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.
      </p>
    );
  }

  if (loadState === "error" || !group) {
    return (
      <p className="p-6 text-sm text-red-600">
        לא הצלחנו לטעון את הקבוצה. נסה לרענן את הדף.
      </p>
    );
  }

  const pendingInvitations = invitations.filter((i) => i.status === "pending");

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {group.name}
      </h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          חברים ({group.members.length})
        </h2>
        <div className="flex flex-col gap-2">
          {group.members.map((member) => (
            <div
              key={member.userId}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              <div className="text-zinc-900 dark:text-zinc-50">
                {member.user.name}
              </div>
              <div className="text-xs text-zinc-500">{member.user.email}</div>
            </div>
          ))}
        </div>
      </section>

      {pendingInvitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            ממתינים לאישור ({pendingInvitations.length})
          </h2>
          <div className="flex flex-col gap-2">
            {pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700"
              >
                {invitation.email}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-zinc-300 pt-6 dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          הזמן חבר
        </h2>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                invite();
              }
            }}
            placeholder="כתובת אימייל"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
          <button
            type="button"
            onClick={invite}
            disabled={inviting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            {inviting ? "שולח…" : "הזמן"}
          </button>
        </div>
        {inviteMessage && (
          <p className="text-sm text-zinc-500">{inviteMessage}</p>
        )}
      </section>
    </div>
  );
}
