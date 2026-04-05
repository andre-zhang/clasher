"use client";

import { ClasherProvider } from "@/context/ClasherContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ClasherProvider>{children}</ClasherProvider>;
}
