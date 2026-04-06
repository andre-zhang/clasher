import { redirect } from "next/navigation";

export default async function InviteRedirectPage({
  params,
}: {
  params: Promise<{ squadId: string }>;
}) {
  const { squadId } = await params;
  redirect(`/squad/${squadId}/options`);
}
