import { AcceptInvitation } from "./AcceptInvitation";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <AcceptInvitation token={token} />
    </div>
  );
}
