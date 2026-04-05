import { redirect } from "next/navigation";

export default async function SquadIndexPage({
  params,
}: {
  params: Promise<{ squadId: string }>;
}) {
  const { squadId } = await params;
  redirect(`/squad/${squadId}/lineup`);
}
