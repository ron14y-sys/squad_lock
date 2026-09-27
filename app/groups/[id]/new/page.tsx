import { NewMeeting } from "./NewMeeting";

export default async function NewMeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col">
      <NewMeeting groupId={id} />
    </div>
  );
}
