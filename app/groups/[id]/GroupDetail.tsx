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
    return <p className="sl-page sl-sub">טוען את הקבוצה…</p>;
  }

  if (loadState === "signed-out") {
    return <p className="sl-page sl-sub">התחבר כדי לראות את הקבוצה.</p>;
  }

  if (loadState === "not-found") {
    return (
      <p className="sl-page sl-sub">הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.</p>
    );
  }

  if (loadState === "error" || !group) {
    return (
      <p className="sl-page sl-sub">
        לא הצלחנו לטעון את הקבוצה. נסה לרענן את הדף.
      </p>
    );
  }

  const pendingInvitations = invitations.filter((i) => i.status === "pending");

  return (
    <div className="sl-page">
      <h1 className="sl-sec">{group.name}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="sl-sec">חברים ({group.members.length})</h2>
        <div className="flex flex-col gap-2">
          {group.members.map((member) => (
            <div key={member.userId} className="sl-field">
              <div className="font-bold">{member.user.name}</div>
              <div className="sl-sub">{member.user.email}</div>
            </div>
          ))}
        </div>
      </section>

      {pendingInvitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="sl-sec">
            ממתינים לאישור ({pendingInvitations.length})
          </h2>
          <div className="flex flex-col gap-2">
            {pendingInvitations.map((invitation) => (
              <div key={invitation.id} className="sl-panel sl-sub">
                {invitation.email}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="sl-sec">הזמן חבר</h2>
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
            className="sl-field flex-1"
          />
          <button
            type="button"
            onClick={invite}
            disabled={inviting}
            className="sl-btn go"
          >
            {inviting ? "שולח…" : "הזמן"}
          </button>
        </div>
        {inviteMessage && <p className="sl-sub">{inviteMessage}</p>}
      </section>
    </div>
  );
}
