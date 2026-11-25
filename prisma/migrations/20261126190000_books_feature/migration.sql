-- Accounts (Books) is a plan module: on the Premium plan and in the free trial.
-- Other plans can get it through the console (plan edit or a business's override).
UPDATE "Plan" SET "features" = array_append("features", 'books')
WHERE "code" IN ('premium', 'trial') AND NOT ('books' = ANY("features"));
