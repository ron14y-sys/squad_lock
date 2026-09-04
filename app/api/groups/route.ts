// Group creation and listing (B4, spec §1.2, §5.3). POST creates a group
// with the signed-in user as its first member — a group with nobody in it
// is not a state anything downstream (invites, meetings) needs to handle.
// GET lists every group the signed-in user belongs to, roster included.

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { createGroupSchema } from "@/lib/groups/schema";

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const prisma = getPrisma();
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "desc" },
    include: {
      members: {
        orderBy: { joinedAt: "asc" },
        select: {
          userId: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  return Response.json(groups);
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = createGroupSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid group.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const prisma = getPrisma();
  const group = await prisma.group.create({
    data: {
      name: parsed.data.name,
      members: { create: { userId } },
    },
  });

  return Response.json(group, { status: 201 });
}
