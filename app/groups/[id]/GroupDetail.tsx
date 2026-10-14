"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenState } from "@/app/_components/ScreenState";
import { membersLabel } from "@/lib/format/hebrew-labels";
import { GROUP_SIZE_FLOOR } from "@/lib/groups/size";

type GroupMember = {
  userId: string;
  joinedAt: string;
  isAdmin: boolean;
  user: { name: string; email: string };
};

type Group = {
  id: string;
  name: string;
  members: GroupMember[];
  /** Whether the person looking is the one who runs it (#250). */
  viewerIsAdmin: boolean;
  /** Meetings that would be deleted with it: everything not cancelled. */
  plannedMeetings: number;
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
  "That is your own address.": "זו הכתובת שלך. אי אפשר להזמין את עצמך.",
  "This address cannot receive email.":
    "לכתובת הזו אי אפשר לשלוח מייל. כדאי לבדוק שאין טעות הקלדה.",
};

const KNOWN_MANAGE_ERRORS: Record<string, string> = {
  "Group not found.": "הקבוצה הזו לא נמצאה.",
  "You are the last member. Delete the group instead.":
    "אתה החבר האחרון, ולכן אפשר רק למחוק את הקבוצה.",
  "Only the admin can delete the group.": "רק המנהל/ת יכול/ה למחוק את הקבוצה.",
  "Only the admin can remove a member.": "רק המנהל/ת יכול/ה להסיר חברים.",
};

function groupFullMessage(message: string): string | null {
  // GroupFullError's text (#174), e.g. "Group g1 already has 6 members or
  // pending invitations."
  if (!/already has \d+ members or pending invitations\./.test(message)) {
    return null;
  }
  return "הקבוצה מלאה (מקסימום 6 חברים, כולל הזמנות ממתינות).";
}

export function GroupDetail({ groupId }: { groupId: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [group, setGroup] = useState<Group | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const router = useRouter();
  // #250: leaving and deleting each ask first, in the page itself.
  const [confirming, setConfirming] = useState<"none" | "leave" | "delete">(
    "none"
  );
  const [managing, setManaging] = useState(false);
  const [manageMessage, setManageMessage] = useState<string | null>(null);
  // #256: the member the admin is asked about removing.
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);

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
          groupFullMessage(body.error ?? "") ??
            KNOWN_INVITE_ERRORS[body.error] ??
            "לא הצלחנו לשלוח את ההזמנה."
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

  async function cancelInvitation(invitation: Invitation) {
    setInviteMessage(null);
    try {
      const res = await fetch(
        `/api/groups/${groupId}/invitations/${invitation.id}`,
        { method: "DELETE" }
      );
      // 404: already gone (cancelled from another screen) — same end state.
      if (!res.ok && res.status !== 404) {
        setInviteMessage(
          res.status === 409
            ? `${invitation.email} כבר הצטרף/ה לקבוצה.`
            : "לא הצלחנו לבטל את ההזמנה. נסה שוב."
        );
      } else {
        setInviteMessage(`ההזמנה ל-${invitation.email} בוטלה.`);
      }
      load();
    } catch {
      setInviteMessage("לא הצלחנו לבטל את ההזמנה. נסה שוב.");
    }
  }

  async function manage(kind: "leave" | "delete") {
    setManaging(true);
    setManageMessage(null);
    try {
      const res = await fetch(
        kind === "leave"
          ? `/api/groups/${groupId}/leave`
          : `/api/groups/${groupId}`,
        { method: kind === "leave" ? "POST" : "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setManageMessage(
          KNOWN_MANAGE_ERRORS[body.error] ?? "לא הצלחנו. נסה שוב."
        );
        return;
      }
      router.push("/groups");
    } catch {
      setManageMessage("לא הצלחנו. נסה שוב.");
    } finally {
      setManaging(false);
    }
  }

  async function removeMember(member: GroupMember) {
    setManaging(true);
    setRemoveMessage(null);
    try {
      const res = await fetch(
        `/api/groups/${groupId}/members/${member.userId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRemoveMessage(
          KNOWN_MANAGE_ERRORS[body.error] ?? "לא הצלחנו. נסה שוב."
        );
        return;
      }
      setRemoving(null);
      setRemoveMessage(`${member.user.name} הוסר/ה מהקבוצה.`);
      load();
    } catch {
      setRemoveMessage("לא הצלחנו. נסה שוב.");
    } finally {
      setManaging(false);
    }
  }

  if (loadState === "loading") {
    return <ScreenState kind="loading">טוען את הקבוצה…</ScreenState>;
  }

  if (loadState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי לראות את הקבוצה.
      </ScreenState>
    );
  }

  if (loadState === "not-found") {
    return (
      <ScreenState kind="notice">
        הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.
      </ScreenState>
    );
  }

  if (loadState === "error" || !group) {
    return (
      <ScreenState kind="error">
        לא הצלחנו לטעון את הקבוצה. נסה לרענן את הדף.
      </ScreenState>
    );
  }

  const pendingInvitations = invitations.filter((i) => i.status === "pending");
  const remainingAfterLeaving = group.members.length - 1;
  const isLastMember = remainingAfterLeaving === 0;

  return (
    <div className="sl-page">
      <Link href="/groups" className="sl-sub self-start">
        &rsaquo; לכל הקבוצות
      </Link>
      <h1 className="sl-sec">{group.name}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="sl-sec">חברים ({group.members.length})</h2>
        <div className="flex flex-col gap-2">
          {group.members.map((member) => (
            <div
              key={member.userId}
              className="sl-field flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="font-bold">
                  {member.user.name}
                  {member.isAdmin && (
                    <span className="sl-sub font-normal"> · מנהל/ת</span>
                  )}
                </div>
                <div className="sl-sub break-all">{member.user.email}</div>
              </div>
              {/* #256: the admin removes anyone but themselves. */}
              {group.viewerIsAdmin && !member.isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setRemoving(member);
                    setRemoveMessage(null);
                  }}
                  className="sl-btn shrink-0"
                  aria-label={`הסר את ${member.user.name}`}
                >
                  הסר
                </button>
              )}
            </div>
          ))}
        </div>

        {removing && (
          <div className="sl-panel">
            <p>
              להסיר את {removing.user.name} מ-&quot;{group.name}&quot;?
              יוסר/תוסר מהפגישות הפתוחות בקבוצה.
            </p>
            {remainingAfterLeaving < GROUP_SIZE_FLOOR && (
              <p className="sl-sub">
                הפגישות הפתוחות בקבוצה יבוטלו, ולא יהיה אפשר לפתוח חדשות עד
                שיצטרפו עוד חברים.
              </p>
            )}
            <div className="sl-row">
              <button
                type="button"
                disabled={managing}
                onClick={() => removeMember(removing)}
                className="sl-btn"
              >
                כן, להסיר
              </button>
              <button
                type="button"
                disabled={managing}
                onClick={() => setRemoving(null)}
                className="sl-btn"
              >
                ביטול
              </button>
            </div>
          </div>
        )}
        {removeMessage && <p className="sl-sub">{removeMessage}</p>}
      </section>

      {pendingInvitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="sl-sec">
            ממתינים לאישור ({pendingInvitations.length})
          </h2>
          <div className="flex flex-col gap-2">
            {pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="sl-panel sl-sub flex items-center justify-between gap-2"
              >
                <span className="min-w-0 break-all">{invitation.email}</span>
                <button
                  type="button"
                  onClick={() => cancelInvitation(invitation)}
                  className="sl-btn shrink-0"
                  aria-label={`בטל את ההזמנה ל-${invitation.email}`}
                >
                  בטל הזמנה
                </button>
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

      <section className="flex flex-col gap-2">
        <h2 className="sl-sec">ניהול הקבוצה</h2>
        {isLastMember && (
          <p className="sl-sub">
            אתה החבר האחרון בקבוצה, ולכן אפשר רק למחוק אותה.
          </p>
        )}

        {confirming === "none" && (
          <div className="sl-row">
            {!isLastMember && (
              <button
                type="button"
                onClick={() => setConfirming("leave")}
                className="sl-btn"
              >
                עזיבת הקבוצה
              </button>
            )}
            {group.viewerIsAdmin && (
              <button
                type="button"
                onClick={() => setConfirming("delete")}
                className="sl-btn"
              >
                מחיקת הקבוצה
              </button>
            )}
          </div>
        )}

        {confirming === "leave" && (
          <div className="sl-panel">
            <p>
              לעזוב את &quot;{group.name}&quot;? תוסר מהפגישות הפתוחות בקבוצה.
            </p>
            <p className="sl-sub">
              אחרי העזיבה יישארו בקבוצה {membersLabel(remainingAfterLeaving)}.
            </p>
            {remainingAfterLeaving < GROUP_SIZE_FLOOR && (
              <p className="sl-sub">
                הפגישות הפתוחות בקבוצה יבוטלו, ולא יהיה אפשר לפתוח חדשות עד
                שיצטרפו עוד חברים.
              </p>
            )}
            {group.viewerIsAdmin && (
              <p className="sl-sub">
                אתה המנהל/ת, והתפקיד יעבור באקראי לאחד החברים שנשארים.
              </p>
            )}
            <div className="sl-row">
              <button
                type="button"
                disabled={managing}
                onClick={() => manage("leave")}
                className="sl-btn"
              >
                כן, לעזוב
              </button>
              <button
                type="button"
                disabled={managing}
                onClick={() => setConfirming("none")}
                className="sl-btn"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {confirming === "delete" && (
          <div className="sl-panel">
            <p>
              למחוק את &quot;{group.name}&quot;? כל החברים יוצאו ממנה
              {group.plannedMeetings > 0
                ? `, וכל הפגישות בה (${
                    group.plannedMeetings === 1
                      ? "פגישה אחת"
                      : `${group.plannedMeetings} פגישות`
                  }, גם כאלה שאושרו) יימחקו.`
                : ", וכל מה שבה יימחק."}
            </p>
            <p className="sl-sub">אי אפשר לשחזר.</p>
            <div className="sl-row">
              <button
                type="button"
                disabled={managing}
                onClick={() => manage("delete")}
                className="sl-btn"
              >
                כן, למחוק
              </button>
              <button
                type="button"
                disabled={managing}
                onClick={() => setConfirming("none")}
                className="sl-btn"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {manageMessage && <p className="sl-sub">{manageMessage}</p>}
      </section>
    </div>
  );
}
