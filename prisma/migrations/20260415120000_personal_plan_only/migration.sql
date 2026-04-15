-- Mine-only plan acts: wants true but excluded from "Everyone" / group strip aggregation.
ALTER TABLE "MemberSlotIntent" ADD COLUMN "personalPlanOnly" BOOLEAN NOT NULL DEFAULT false;
