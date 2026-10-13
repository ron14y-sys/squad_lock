// Deleting a group (#250). Only its admin can, and it takes every meeting in
// it along. See `deleteGroup` in lib/db/group-membership.ts.

import { auth } from "@/auth";
import {
  NotInGroupError,
  NotTheAdminError,
  deleteGroup,
} from "@/lib/db/group-membership";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: groupId } = await params;

  try {
    await deleteGroup(userId, groupId);
    return new Response(null, { status: 204 });
  } catch (error) {
    // The same single answer the other group routes give: a group that does
    // not exist and one the caller is not in look alike from outside.
    if (error instanceof NotInGroupError) {
      return Response.json({ error: "Group not found." }, { status: 404 });
    }
    if (error instanceof NotTheAdminError) {
      return Response.json(
        { error: "Only the admin can delete the group." },
        { status: 403 }
      );
    }
    throw error;
  }
}
