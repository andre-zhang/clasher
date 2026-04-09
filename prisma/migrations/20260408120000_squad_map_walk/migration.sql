-- AlterTable
ALTER TABLE "Squad" ADD COLUMN "walkTimesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Squad" ADD COLUMN "festivalMapMime" TEXT;
ALTER TABLE "Squad" ADD COLUMN "festivalMapData" TEXT;
ALTER TABLE "Squad" ADD COLUMN "mapStageLabelsJson" JSONB;
ALTER TABLE "Squad" ADD COLUMN "stageAliasJson" JSONB;
ALTER TABLE "Squad" ADD COLUMN "walkMatrixJson" JSONB;
