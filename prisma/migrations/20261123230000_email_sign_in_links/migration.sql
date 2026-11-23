-- AlterEnum
ALTER TYPE "EmailPurpose" ADD VALUE 'LINK';

-- AlterTable
ALTER TABLE "PlatformPasswordReset" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'reset';

