-- AlterTable
ALTER TABLE "SquadClashDefault" ADD COLUMN "defaultPlanMode" TEXT NOT NULL DEFAULT 'pick',
ADD COLUMN "splitFirstSlotId" TEXT,
ADD COLUMN "splitSecondSlotId" TEXT,
ADD COLUMN "customWindows" JSONB;

ALTER TABLE "SquadClashDefault" ALTER COLUMN "choiceSlotId" DROP NOT NULL;
