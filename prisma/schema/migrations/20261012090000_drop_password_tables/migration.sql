-- Sign-in is passwordless (email and phone codes, OAuth): nothing reads or writes these.

-- DropTable
DROP TABLE "iam_credentials";

-- DropTable
DROP TABLE "iam_verification_codes";

-- DropEnum
DROP TYPE "VerificationPurpose";
