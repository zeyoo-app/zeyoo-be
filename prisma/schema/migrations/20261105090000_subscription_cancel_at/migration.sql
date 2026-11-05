-- When a cancelled plan ends; the plan stays active until then.
ALTER TABLE "billing_subscriptions" ADD COLUMN "cancelAt" TIMESTAMP(3);
