export type RatingTier = "must" | "want" | "maybe" | "skip";

export interface FestivalSnapshot {
  id: string;
  festivalName: string;
  inviteToken: string;
  phase: string;
  festivalDate: string | null;
  members: { id: string; displayName: string }[];
  artists: { id: string; name: string; sortOrder: number }[];
  ratings: { memberId: string; artistId: string; tier: string }[];
  comments: {
    id: string;
    artistId: string;
    memberId: string;
    body: string;
    createdAt: string;
  }[];
  schedule: {
    id: string;
    dayLabel: string;
    stageName: string;
    start: string;
    end: string;
    artistId: string;
    artistName: string;
  }[];
  conflictResolutions: {
    memberId: string;
    slotAId: string;
    slotBId: string;
    choice: string | null;
    planNote: string | null;
    individualOnly: boolean;
    planMode: string | null;
    splitFirstSlotId: string | null;
    splitSecondSlotId: string | null;
    groupLeanSlotId: string | null;
  }[];
  memberSlotIntents: {
    slotId: string;
    wants: boolean;
    planFrom: string | null;
    planTo: string | null;
  }[];
  allMemberSlotIntents: {
    memberId: string;
    slotId: string;
    wants: boolean;
    planFrom: string | null;
    planTo: string | null;
  }[];
  squadClashDefaults: {
    slotAId: string;
    slotBId: string;
    choiceSlotId: string;
    setByMemberId: string;
  }[];
}

export interface ClasherSession {
  squadId: string;
  memberId: string;
  memberSecret: string;
  inviteToken: string;
}

export const SESSION_STORAGE_KEY = "clasher_session";
