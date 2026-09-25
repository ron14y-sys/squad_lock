import { MeetingDetail } from "./MeetingDetail";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col">
      <MeetingDetail meetingId={id} />
    </div>
  );
}
