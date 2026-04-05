import { SquadShell } from "./SquadShell";

export default async function SquadLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ squadId: string }>;
}) {
  const { squadId } = await params;
  return <SquadShell squadId={squadId}>{children}</SquadShell>;
}
