process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://zeyoo@127.0.0.1:5544/zeyoo?schema=public';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-value';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-value';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.APP_WEB_URL = 'http://localhost:3000';
process.env.UPLOAD_DIR = 'test/.tmp-uploads';
process.env.PUBLIC_ASSET_BASE_URL = 'http://localhost:3000/uploads';

import { rmSync } from 'node:fs';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { UploadsService } from '../../src/modules/media/media.public';
import { Mailer } from '../../src/platform/mail';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AllExceptionsFilter } from '../../src/platform/http/all-exceptions.filter';
import { IMAGE_MAX_BYTES } from '../../src/platform/http/image-upload.constants';

/** Smallest valid PNG, so uploads are real image bytes rather than a stub. */
const pngBytes =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const fakePaymentGateway = {
  // A unique intent id per call, like the real gateway, so persisted funding
  // rows never collide on the stripePaymentIntentId unique constraint.
  createFundingIntent: jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ intentId: `pi_${Date.now()}_${Math.random()}`, clientSecret: 'cs_test' }),
    ),
  createPayout: jest.fn().mockResolvedValue({ payoutId: 'po_test' }),
  parseWebhookEvent: jest.fn().mockReturnValue({ kind: 'IGNORED' }),
};
const fakeBillingGateway = {
  createSubscriptionCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.test' }),
  parseWebhookEvent: jest.fn().mockReturnValue({ kind: 'IGNORED' }),
};
/** Captures the emailed sign-in code so a test can complete the passwordless flow. */
const sentCodes = new Map<string, string>();
const fakeMailer = {
  sendSignInCode: jest.fn().mockImplementation((to: string, code: string) => {
    sentCodes.set(to, code);
    return Promise.resolve();
  }),
};
const fakeAiProvider = { generate: jest.fn().mockResolvedValue('Draft output.') };

describe('Zeyoo API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let http: () => request.SuperTest<request.Test>;

  const runId = Date.now();
  const brand = { email: `brand-${runId}@test.dev`, token: '' };
  const creator = {
    email: `creator-${runId}@test.dev`,
    token: '',
    userId: '',
  };
  const adminUser = { email: `admin-${runId}@test.dev`, token: '' };

  let organizationId: string;
  let campaignId: string;
  let applicationId: string;
  let submissionId: string;
  let disputeId: string;

  /** Runs the real email-code flow: request a code, read it from the fake mailer, verify it. */
  const signInWithEmail = async (email: string, userType?: 'BRAND_USER' | 'CREATOR') => {
    const requested = await http().post('/v1/auth/email/code').send({ email });
    expect(requested.status).toBe(200);
    const verified = await http()
      .post('/v1/auth/email/code/verify')
      .send({ email, code: sentCodes.get(email), userType });
    expect(verified.status).toBe(200);
    return verified.body as { accessToken: string; isNewUser: boolean };
  };

  const auth = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('PaymentGatewayPort')
      .useValue(fakePaymentGateway)
      .overrideProvider('BillingGatewayPort')
      .useValue(fakeBillingGateway)
      .overrideProvider(Mailer)
      .useValue(fakeMailer)
      .overrideProvider('AiProviderPort')
      .useValue(fakeAiProvider)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    // Mirrors bootstrap in main.ts: uploaded images are public static assets.
    app.useStaticAssets(app.get(UploadsService).storageRoot, { prefix: '/uploads' });
    await app.init();

    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer()) as unknown as request.SuperTest<request.Test>;

    await prisma.user.create({
      data: {
        email: adminUser.email,
        type: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(process.env.UPLOAD_DIR as string, { recursive: true, force: true });
  });

  it('reports health', async () => {
    const response = await http().get('/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('signs up a brand and creator and signs in an admin by emailed code', async () => {
    const brandRes = await signInWithEmail(brand.email, 'BRAND_USER');
    expect(brandRes.isNewUser).toBe(true);
    brand.token = brandRes.accessToken;

    const creatorRes = await signInWithEmail(creator.email, 'CREATOR');
    expect(creatorRes.isNewUser).toBe(true);
    creator.token = creatorRes.accessToken;

    const adminRes = await signInWithEmail(adminUser.email);
    expect(adminRes.isNewUser).toBe(false);
    adminUser.token = adminRes.accessToken;

    const me = await http().get('/v1/me').set(auth(creator.token));
    expect(me.status).toBe(200);
    creator.userId = me.body.id;
  });

  it('rejects an unauthenticated request', async () => {
    const response = await http().get('/v1/me');
    expect(response.status).toBe(401);
  });

  it('lets a brand create and publish a public campaign', async () => {
    const orgRes = await http()
      .post('/v1/organizations')
      .set(auth(brand.token))
      .send({ name: `Brand ${runId}` });
    expect(orgRes.status).toBe(201);
    organizationId = orgRes.body.id;

    const campaignRes = await http()
      .post(`/v1/organizations/${organizationId}/campaigns`)
      .set(auth(brand.token))
      .send({
        title: 'Summer Launch',
        description: 'Promote the summer line.',
        platform: 'TIKTOK',
        visibility: 'PUBLIC',
        startDate: '2026-01-01',
        endDate: '2026-03-01',
        currencyCode: 'USD',
        budgetAmount: 500000,
        rewardType: 'FIXED_PER_ITEM',
        rewardAmount: 5000,
      });
    expect(campaignRes.status).toBe(201);
    campaignId = campaignRes.body.id;

    const publishRes = await http()
      .post(`/v1/campaigns/${campaignId}/publish`)
      .set(auth(brand.token));
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe('PUBLISHED');

    const discover = await http().get('/v1/campaigns/discover').set(auth(creator.token));
    expect(discover.status).toBe(200);
    expect(discover.body.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it('forbids a creator from creating a campaign (permission)', async () => {
    const response = await http()
      .post(`/v1/organizations/${organizationId}/campaigns`)
      .set(auth(creator.token))
      .send({
        title: 'Nope',
        description: 'x',
        platform: 'TIKTOK',
        startDate: '2026-01-01',
        endDate: '2026-03-01',
        currencyCode: 'USD',
        budgetAmount: 1000,
        rewardType: 'FIXED_PER_ITEM',
        rewardAmount: 100,
      });
    expect(response.status).toBe(403);
  });

  it('lets a creator build a profile and connect a social account', async () => {
    const profileRes = await http()
      .post('/v1/creator-profile')
      .set(auth(creator.token))
      .send({ displayName: 'Creator One', country: 'US' });
    expect(profileRes.status).toBe(201);

    const socialRes = await http()
      .post('/v1/creator-profile/social-accounts')
      .set(auth(creator.token))
      .send({ platform: 'TIKTOK', handle: 'creator.one' });
    expect(socialRes.status).toBe(201);

    const directory = await http().get(`/v1/creators/${creator.userId}`).set(auth(brand.token));
    expect(directory.status).toBe(200);
    expect(directory.body.socialAccounts).toHaveLength(1);
  });

  it('runs the application and submission review loop', async () => {
    const applyRes = await http()
      .post(`/v1/campaigns/${campaignId}/applications`)
      .set(auth(creator.token))
      .send({ acceptedTerms: true, message: 'Keen to join.' });
    expect(applyRes.status).toBe(201);
    applicationId = applyRes.body.id;

    const approveRes = await http()
      .post(`/v1/applications/${applicationId}/approve`)
      .set(auth(brand.token));
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');

    const submitRes = await http()
      .post(`/v1/campaigns/${campaignId}/submissions`)
      .set(auth(creator.token))
      .send({ contentType: 'LINK', contentUrl: 'https://tiktok.com/@creator.one/video/1' });
    expect(submitRes.status).toBe(201);
    submissionId = submitRes.body.id;

    const reviewRes = await http()
      .post(`/v1/submissions/${submissionId}/review`)
      .set(auth(brand.token))
      .send({ decision: 'APPROVED' });
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.status).toBe('APPROVED');
  });

  it('ingests metrics and assesses fraud', async () => {
    const ingest = await http()
      .post(`/v1/campaigns/${campaignId}/metrics`)
      .set(auth(brand.token))
      .send({
        creatorUserId: creator.userId,
        platform: 'TIKTOK',
        views: 1000,
        likes: 100,
        comments: 10,
        shares: 5,
      });
    expect(ingest.status).toBe(201);

    const assess = await http()
      .post(`/v1/campaigns/${campaignId}/fraud/assess`)
      .set(auth(brand.token))
      .send({ views: 100, likes: 200, comments: 0, shares: 0 });
    expect(assess.status).toBe(200);
    expect(assess.body.level).toBe('HIGH');
  });

  it('funds a campaign and returns a client secret', async () => {
    const response = await http()
      .post(`/v1/campaigns/${campaignId}/funding`)
      .set(auth(brand.token))
      .send({ amountMinor: 100000 });
    expect(response.status).toBe(201);
    expect(response.body.clientSecret).toBe('cs_test');
  });

  it('produces a campaign analytics report', async () => {
    const response = await http().get(`/v1/campaigns/${campaignId}/report`).set(auth(brand.token));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      campaignId,
      applications: { total: 1, approved: 1 },
      submissions: { total: 1, approved: 1 },
    });
  });

  it('rejects a withdrawal above the available balance', async () => {
    const response = await http()
      .post('/v1/me/withdrawals')
      .set(auth(creator.token))
      .send({ amountMinor: 1000, currencyCode: 'USD' });
    expect(response.status).toBe(409);
  });

  it('serves notifications and preferences', async () => {
    const list = await http().get('/v1/me/notifications').set(auth(creator.token));
    expect(list.status).toBe(200);

    const prefs = await http()
      .patch('/v1/me/notification-preferences')
      .set(auth(creator.token))
      .send({ emailEnabled: false });
    expect(prefs.status).toBe(200);
    expect(prefs.body.emailEnabled).toBe(false);
  });

  it('registers a media asset', async () => {
    const response = await http()
      .post('/v1/media/assets')
      .set(auth(creator.token))
      .send({ kind: 'VIDEO', sourceUrl: 'https://cdn.test/video.mp4' });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');
  });

  it('uploads a brand logo and returns a URL the API will accept', async () => {
    const response = await http()
      .post('/v1/media/uploads/images')
      .set(auth(brand.token))
      .attach('file', Buffer.from(pngBytes, 'base64'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ contentType: 'image/png' });
    expect(response.body.key).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(response.body.url).toBe(
      `${process.env.PUBLIC_ASSET_BASE_URL ?? 'http://localhost:3000/uploads'}/${response.body.key}`,
    );

    const stored = await prisma.mediaAsset.findUnique({ where: { id: response.body.id } });
    expect(stored).toMatchObject({ kind: 'IMAGE', status: 'READY' });

    // The URL must actually serve the bytes, unauthenticated — an <Image> tag
    // cannot send a bearer token.
    const served = await http().get(`/uploads/${response.body.key}`);
    expect(served.status).toBe(200);
    expect(served.body).toEqual(Buffer.from(pngBytes, 'base64'));

    // The URL is what a client persists: creating an organization with it must pass.
    const org = await http()
      .post('/v1/organizations')
      .set(auth(brand.token))
      .send({ name: `Logo Brand ${runId}`, logoUrl: response.body.url });
    expect(org.status).toBe(201);
    expect(org.body.logoUrl).toBe(response.body.url);
  });

  it('rejects a non-image and an unauthenticated upload', async () => {
    const notAnImage = await http()
      .post('/v1/media/uploads/images')
      .set(auth(brand.token))
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), {
        filename: 'payload.sh',
        contentType: 'application/x-sh',
      });
    expect(notAnImage.status).toBe(400);

    const anonymous = await http()
      .post('/v1/media/uploads/images')
      .attach('file', Buffer.from(pngBytes, 'base64'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });
    expect(anonymous.status).toBe(401);
  });

  it('rejects an image over the size limit', async () => {
    const response = await http()
      .post('/v1/media/uploads/images')
      .set(auth(brand.token))
      .attach('file', Buffer.alloc(IMAGE_MAX_BYTES + 1024, 1), {
        filename: 'huge.png',
        contentType: 'image/png',
      });
    expect(response.status).toBe(413);
  });

  it('lists billing plans', async () => {
    const response = await http().get('/v1/billing/plans').set(auth(brand.token));
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('opens a dispute and adds a message', async () => {
    const open = await http()
      .post('/v1/disputes')
      .set(auth(creator.token))
      .send({ subjectType: 'CAMPAIGN', subjectId: campaignId, reason: 'Payout delayed.' });
    expect(open.status).toBe(201);
    disputeId = open.body.id;

    const message = await http()
      .post(`/v1/disputes/${disputeId}/messages`)
      .set(auth(creator.token))
      .send({ message: 'Any update?' });
    expect(message.status).toBe(201);
  });

  it('runs AI assistant endpoints', async () => {
    const brief = await http()
      .post('/v1/ai/campaign-brief')
      .set(auth(brand.token))
      .send({ idea: 'A summer campaign for sneakers.' });
    expect(brief.status).toBe(200);
    expect(brief.body.response).toBe('Draft output.');
  });

  it('exposes admin endpoints only to admins', async () => {
    const forbidden = await http().get('/v1/admin/users').set(auth(brand.token));
    expect(forbidden.status).toBe(403);

    const users = await http().get('/v1/admin/users').set(auth(adminUser.token));
    expect(users.status).toBe(200);

    const category = await http()
      .post('/v1/admin/campaign-categories')
      .set(auth(adminUser.token))
      .send({ name: `Fashion ${runId}` });
    expect(category.status).toBe(201);

    const disputes = await http().get('/v1/admin/disputes').set(auth(adminUser.token));
    expect(disputes.status).toBe(200);
    expect(disputes.body.some((d: { id: string }) => d.id === disputeId)).toBe(true);
  });
});
