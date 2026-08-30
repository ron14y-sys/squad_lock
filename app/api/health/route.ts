import { prisma } from "@/lib/db/client";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "connected" });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        db: "unreachable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 }
    );
  }
}
