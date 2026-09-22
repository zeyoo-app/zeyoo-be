-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('BRAND_USER', 'CREATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'APPLE');

-- CreateTable
CREATE TABLE "iam_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iam_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iam_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_oauth_identities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_oauth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iam_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_teams" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iam_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "teamId" UUID,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_api_keys" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "iam_users_email_key" ON "iam_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "iam_credentials_userId_key" ON "iam_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "iam_refresh_tokens_tokenHash_key" ON "iam_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "iam_refresh_tokens_userId_idx" ON "iam_refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "iam_oauth_identities_userId_idx" ON "iam_oauth_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "iam_oauth_identities_provider_providerUserId_key" ON "iam_oauth_identities"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "iam_organizations_slug_key" ON "iam_organizations"("slug");

-- CreateIndex
CREATE INDEX "iam_teams_organizationId_idx" ON "iam_teams"("organizationId");

-- CreateIndex
CREATE INDEX "iam_memberships_organizationId_idx" ON "iam_memberships"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "iam_memberships_userId_organizationId_key" ON "iam_memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "iam_api_keys_prefix_key" ON "iam_api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "iam_api_keys_keyHash_key" ON "iam_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "iam_api_keys_organizationId_idx" ON "iam_api_keys"("organizationId");

-- AddForeignKey
ALTER TABLE "iam_credentials" ADD CONSTRAINT "iam_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "iam_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_refresh_tokens" ADD CONSTRAINT "iam_refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "iam_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_oauth_identities" ADD CONSTRAINT "iam_oauth_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "iam_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_teams" ADD CONSTRAINT "iam_teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "iam_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_memberships" ADD CONSTRAINT "iam_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "iam_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_memberships" ADD CONSTRAINT "iam_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "iam_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_memberships" ADD CONSTRAINT "iam_memberships_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "iam_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam_api_keys" ADD CONSTRAINT "iam_api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "iam_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

