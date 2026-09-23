process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://zeyoo@127.0.0.1:5544/zeyoo?schema=public';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-value';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-value';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.APP_WEB_URL = 'http://localhost:3000';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AllExceptionsFilter } from '../../src/platform/http/all-exceptions.filter';

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
const fakeAiProvider = { generate: jest.fn().mockResolvedValue('Draft output.') };

describe('Zeyoo API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => request.SuperTest<request.Test>;

  const runId = Date.now();
  const brand = { email: `brand-${runId}@test.dev`, password: 'password123', token: '' };
  const creator = {
    email: `creator-${runId}@test.dev`,
    password: 'password123',
    token: '',
    userId: '',
  };
  const adminUser = { email: `admin-${runId}@test.dev`, password: 'password123', token: '' };

  let organizationId: string;
  let campaignId: string;
  let applicationId: string;
  let submissionId: string;
  let disputeId: string;

  const auth = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('PaymentGatewayPort')
      .useValue(fakePaymentGateway)
      .overrideProvider('BillingGatewayPort')
      .useValue(fakeBillingGateway)
      .overrideProvider('AiProviderPort')
      .useValue(fakeAiProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer()) as unknown as request.SuperTest<request.Test>;

    await prisma.user.create({
      data: {
        email: adminUser.email,
        type: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        credential: { create: { passwordHash: await argon2.hash(adminUser.password) } },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health', async () => {
    const response = await http().get('/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('registers and logs in a brand, creator, and admin', async () => {
    const brandRes = await http()
      .post('/v1/auth/register')
      .send({ email: brand.email, password: brand.password, userType: 'BRAND_USER' });
    expect(brandRes.status).toBe(201);
    brand.token = brandRes.body.accessToken;

    const creatorRes = await http()
      .post('/v1/auth/register')
      .send({ email: creator.email, password: creator.password, userType: 'CREATOR' });
    expect(creatorRes.status).toBe(201);
    creator.token = creatorRes.body.accessToken;

    const adminRes = await http()
      .post('/v1/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });
    expect(adminRes.status).toBe(200);
    adminUser.token = adminRes.body.accessToken;

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
