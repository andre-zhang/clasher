"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  apiAddComment,
  apiAddSlotComment,
  apiAnalyzeFestivalMap,
  apiBulkArtists,
  apiDeleteSquad,
  apiDemoFull,
  apiParseLineupImage,
  apiParseScheduleImages,
  apiPatchScheduleKeep,
  apiPatchSquadOptions,
  apiPeekInvite,
  apiPutSlotIntents,
  apiSyncPlanFromGroup,
  apiReplaceSchedule,
  apiSetConflict,
  type ConflictPlanPayload,
  apiSetRating,
  apiSnapshot,
  type ScheduleDraftSlot,
  apiUploadFestivalMap,
} from "@/lib/api";
import {
  SESSION_STORAGE_KEY,
  type ClasherSession,
  type FestivalSnapshot,
  type RatingTier,
} from "@/lib/types";

function loadSession(): ClasherSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as ClasherSession;
    if (
      j?.squadId &&
      j?.memberId &&
      j?.memberSecret &&
      j?.inviteToken
    ) {
      return j;
    }
    return null;
  } catch {
    return null;
  }
}

function saveSession(s: ClasherSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (s) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

type ClasherContextValue = {
  session: ClasherSession | null;
  group: FestivalSnapshot | null;
  loading: boolean;
  error: string | null;
  setSessionFromAuth: (session: ClasherSession, group: FestivalSnapshot) => void;
  refresh: () => Promise<void>;
  leave: () => void;
  peekInvite: (token: string) => ReturnType<typeof apiPeekInvite>;
  setRating: (artistId: string, tier: RatingTier) => Promise<void>;
  addComment: (artistId: string, body: string) => Promise<void>;
  addSlotComment: (slotId: string, body: string) => Promise<void>;
  commitLineupNames: (names: string[]) => Promise<void>;
  replaceSchedule: (slots: ScheduleDraftSlot[]) => Promise<void>;
  setConflict: (payload: ConflictPlanPayload) => Promise<void>;
  putSlotIntents: (
    intents: {
      slotId: string;
      wants: boolean;
      scheduleKeep?: boolean;
      planFrom?: string | null;
      planTo?: string | null;
    }[]
  ) => Promise<void>;
  /** Set your plan to every act anyone in the group keeps (full slot times). */
  syncPlanFromGroup: () => Promise<void>;
  patchScheduleKeep: (slotId: string, keep: boolean) => Promise<void>;
  loadDemoFull: () => Promise<void>;
  deleteSquad: () => Promise<void>;
  parseLineupFile: (file: File) => Promise<string[]>;
  /** One or more timetable screenshots; results merged and deduped server-side. */
  parseScheduleFiles: (files: File[]) => Promise<ScheduleDraftSlot[]>;
  uploadFestivalMap: (file: File) => Promise<void>;
  analyzeFestivalMap: (file: File) => Promise<void>;
  patchSquadOptions: (patch: {
    walkTimesEnabled?: boolean;
    stageAliasJson?: Record<string, string>;
    walkMatrixJson?: Record<string, Record<string, number>>;
    mapStageLabelsJson?: string[];
  }) => Promise<void>;
};

const ClasherContext = createContext<ClasherContextValue | null>(null);

export function ClasherProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<ClasherSession | null>(null);
  const [group, setGroup] = useState<FestivalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    setHydrated(true);
    if (!s) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const g = await apiSnapshot(s);
        setGroup(g);
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setGroup(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const g = await apiSnapshot(session);
      setGroup(g);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [session]);

  const setSessionFromAuth = useCallback(
    (next: ClasherSession, g: FestivalSnapshot) => {
      saveSession(next);
      setSession(next);
      setGroup(g);
      setError(null);
      setLoading(false);
    },
    []
  );

  const leave = useCallback(() => {
    saveSession(null);
    setSession(null);
    setGroup(null);
    setError(null);
    router.push("/");
  }, [router]);

  const requireSession = useCallback(() => {
    const s = session;
    if (!s) throw new Error("Not signed in to a squad.");
    return s;
  }, [session]);

  const setRating = useCallback(
    async (artistId: string, tier: RatingTier) => {
      const s = requireSession();
      const g = await apiSetRating(s, artistId, tier);
      setGroup(g);
    },
    [requireSession]
  );

  const addComment = useCallback(
    async (artistId: string, body: string) => {
      const s = requireSession();
      const g = await apiAddComment(s, artistId, body);
      setGroup(g);
    },
    [requireSession]
  );

  const addSlotComment = useCallback(
    async (slotId: string, body: string) => {
      const s = requireSession();
      const g = await apiAddSlotComment(s, slotId, body);
      setGroup(g);
    },
    [requireSession]
  );

  const commitLineupNames = useCallback(
    async (names: string[]) => {
      const s = requireSession();
      const g = await apiBulkArtists(s, names);
      setGroup(g);
    },
    [requireSession]
  );

  const replaceSchedule = useCallback(
    async (slots: ScheduleDraftSlot[]) => {
      const s = requireSession();
      const g = await apiReplaceSchedule(s, slots);
      setGroup(g);
    },
    [requireSession]
  );

  const setConflict = useCallback(
    async (payload: ConflictPlanPayload) => {
      const s = requireSession();
      const g = await apiSetConflict(s, payload);
      setGroup(g);
    },
    [requireSession]
  );

  const putSlotIntents = useCallback(
    async (
      intents: {
        slotId: string;
        wants: boolean;
        scheduleKeep?: boolean;
        planFrom?: string | null;
        planTo?: string | null;
      }[]
    ) => {
      const s = requireSession();
      const g = await apiPutSlotIntents(s, intents);
      setGroup(g);
    },
    [requireSession]
  );

  const syncPlanFromGroup = useCallback(async () => {
    const s = requireSession();
    const g = await apiSyncPlanFromGroup(s);
    setGroup(g);
  }, [requireSession]);

  const patchScheduleKeep = useCallback(
    async (slotId: string, keep: boolean) => {
      const s = requireSession();
      const g = await apiPatchScheduleKeep(s, slotId, keep);
      setGroup(g);
    },
    [requireSession]
  );

  const loadDemoFull = useCallback(async () => {
    const s = requireSession();
    const g = await apiDemoFull(s);
    setGroup(g);
  }, [requireSession]);

  const deleteSquad = useCallback(async () => {
    const s = requireSession();
    await apiDeleteSquad(s);
    saveSession(null);
    setSession(null);
    setGroup(null);
    setError(null);
    router.push("/");
  }, [requireSession, router]);

  const parseLineupFile = useCallback(async (file: File) => {
    return apiParseLineupImage(file);
  }, []);

  const parseScheduleFiles = useCallback(async (files: File[]) => {
    return apiParseScheduleImages(files);
  }, []);

  const uploadFestivalMap = useCallback(
    async (file: File) => {
      const s = requireSession();
      const g = await apiUploadFestivalMap(s, file);
      setGroup(g);
    },
    [requireSession]
  );

  const analyzeFestivalMap = useCallback(
    async (file: File) => {
      const s = requireSession();
      const g = await apiAnalyzeFestivalMap(s, file);
      setGroup(g);
    },
    [requireSession]
  );

  const patchSquadOptions = useCallback(
    async (patch: {
      walkTimesEnabled?: boolean;
      stageAliasJson?: Record<string, string>;
      walkMatrixJson?: Record<string, Record<string, number>>;
      mapStageLabelsJson?: string[];
    }) => {
      const s = requireSession();
      const g = await apiPatchSquadOptions(s, patch);
      setGroup(g);
    },
    [requireSession]
  );

  const value = useMemo<ClasherContextValue>(
    () => ({
      session,
      group,
      loading: loading || !hydrated,
      error,
      setSessionFromAuth,
      refresh,
      leave,
      peekInvite: apiPeekInvite,
      setRating,
      addComment,
      addSlotComment,
      commitLineupNames,
      replaceSchedule,
      setConflict,
      putSlotIntents,
      syncPlanFromGroup,
      patchScheduleKeep,
      loadDemoFull,
      deleteSquad,
      parseLineupFile,
      parseScheduleFiles,
      uploadFestivalMap,
      analyzeFestivalMap,
      patchSquadOptions,
    }),
    [
      session,
      group,
      loading,
      hydrated,
      error,
      setSessionFromAuth,
      refresh,
      leave,
      setRating,
      addComment,
      addSlotComment,
      commitLineupNames,
      replaceSchedule,
      setConflict,
      putSlotIntents,
      syncPlanFromGroup,
      patchScheduleKeep,
      loadDemoFull,
      deleteSquad,
      parseLineupFile,
      parseScheduleFiles,
      uploadFestivalMap,
      analyzeFestivalMap,
      patchSquadOptions,
    ]
  );

  return (
    <ClasherContext.Provider value={value}>{children}</ClasherContext.Provider>
  );
}

export function useClasher() {
  const ctx = useContext(ClasherContext);
  if (!ctx) {
    throw new Error("useClasher must be used within ClasherProvider");
  }
  return ctx;
}
