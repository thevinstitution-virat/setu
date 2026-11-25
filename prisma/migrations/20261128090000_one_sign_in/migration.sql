-- One sign-in: a person has the first-sign-in form to fill until this is cleared.
ALTER TABLE "User" ADD COLUMN "onboardingDue" BOOLEAN NOT NULL DEFAULT false;
