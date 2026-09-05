"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type GroupMember = {
  userId: string;
  joinedAt: string;
  user: { name: string; email: string };
};

type Group = {
  id: string;
  name: string;
  createdAt: string;
  members: GroupMember[];
};

type LoadState = "loading" | "ready" | "signed-out" | "error";

export function GroupsList() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    fetch("/api/groups")
      .then((res) => {
        if (res.status === 401) {
          setLoadState("signed-out");
          return null;
        }
        if (!res.ok) throw new Error(`GET /api/groups: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setGroups(data);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }

  useEffect(load, []);

  async function createGroup() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`POST /api/groups: ${res.status}`);
      setName("");
      load();
    } catch {
      setCreateError("לא הצלחנו ליצור את הקבוצה. נסה שוב.");
    } finally {
      setCreating(false);
    }
  }

  if (loadState === "loading") {
    return <p className="p-6 text-sm text-zinc-500">טוען את הקבוצות שלך…</p>;
  }

  if (loadState === "signed-out") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        התחבר כדי לראות את הקבוצות שלך.
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <p className="p-6 text-sm text-red-600">
        לא הצלחנו לטעון את הקבוצות. נסה לרענן את הדף.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        {groups.length === 0 && (
          <p className="text-sm text-zinc-500">עדיין אין לך קבוצות.</p>
        )}
        {groups.map((group) => (
          <Link
            key={group.id}
            href={`/groups/${group.id}`}
            className="rounded-md border border-zinc-300 px-4 py-3 dark:border-zinc-700"
          >
            <div className="font-medium text-zinc-900 dark:text-zinc-50">
              {group.name}
            </div>
            <div className="text-xs text-zinc-500">
              {group.members.length} חברים
            </div>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-zinc-300 pt-6 dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          קבוצה חדשה
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createGroup();
              }
            }}
            placeholder="שם הקבוצה"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
          <button
            type="button"
            onClick={createGroup}
            disabled={creating}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            {creating ? "יוצר…" : "צור"}
          </button>
        </div>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </div>
    </div>
  );
}
