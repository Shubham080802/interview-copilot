import { InterviewRoom } from "./InterviewRoom";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InterviewRoom id={id} />;
}
