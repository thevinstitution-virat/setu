-- A cheque dated after the day it is received is held, not counted: its
-- payment waits as POST_DATED (no ledger entry, no bills paid) until the
-- cheque is banked on or after its date.
ALTER TYPE "PaymentState" ADD VALUE 'POST_DATED';
