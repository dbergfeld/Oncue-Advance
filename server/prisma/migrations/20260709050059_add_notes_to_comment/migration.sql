-- CreateEnum
CREATE TYPE "NoteCategory" AS ENUM ('GENERAL', 'PRODUCTION_CONCERN', 'VENUE_LIMITATION', 'FOLLOW_UP_QUESTION', 'INTERNAL_CREW_NOTE');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('OPEN', 'MONITORING', 'RESOLVED');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "category" "NoteCategory",
ADD COLUMN     "noteStatus" "NoteStatus",
ADD COLUMN     "showId" TEXT;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;
