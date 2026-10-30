-- The page a notification is about, opened when it is tapped (in app, push or email).
ALTER TABLE "notifications" ADD COLUMN "link" TEXT;
