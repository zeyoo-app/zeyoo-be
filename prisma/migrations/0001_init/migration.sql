-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CampaignVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('FIXED_PER_ITEM', 'PER_VIEW');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('CONNECTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('BRAND_USER', 'CREATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'APPLE');

-- CreateTable
CREATE TABLE "campaign_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "categoryId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "goals" TEXT,
    "audience" TEXT,
    "guidelines" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "visibility" "CampaignVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "budgetAmount" INTEGER NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "rewardAmount" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_invitations" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorUserId" UUID NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "campaign_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "country" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_social_accounts" (
    "id" UUID NOT NULL,
    "creatorProfileId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "platformAccountId" TEXT,
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_social_accounts_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "campaign_categories_slug_key" ON "campaign_categories"("slug");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_idx" ON "campaigns"("organizationId");

-- CreateIndex
CREATE INDEX "campaigns_status_visibility_idx" ON "campaigns"("status", "visibility");

-- CreateIndex
CREATE INDEX "campaign_invitations_creatorUserId_idx" ON "campaign_invitations"("creatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_invitations_campaignId_creatorUserId_key" ON "campaign_invitations"("campaignId", "creatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_profiles_userId_key" ON "creator_profiles"("userId");

-- CreateIndex
CREATE INDEX "creator_social_accounts_creatorProfileId_idx" ON "creator_social_accounts"("creatorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_social_accounts_creatorProfileId_platform_key" ON "creator_social_accounts"("creatorProfileId", "platform");

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
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "iam_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "campaign_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitations" ADD CONSTRAINT "campaign_invitations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_social_accounts" ADD CONSTRAINT "creator_social_accounts_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

