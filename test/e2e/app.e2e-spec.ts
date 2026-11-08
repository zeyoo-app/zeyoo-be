process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://zeyoo@127.0.0.1:5544/zeyoo?schema=public';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-value';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-value';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
// Funding goes through the (fake) Stripe Checkout and webhook, never the bypass.
process.env.PAYMENTS_BYPASS_STRIPE = 'false';
process.env.APP_WEB_URL = 'http://localhost:3000';
process.env.R2_ACCOUNT_ID = 'e2e-account';
process.env.R2_ACCESS_KEY_ID = 'e2e-key';
process.env.R2_SECRET_ACCESS_KEY = 'e2e-secret';
process.env.R2_BUCKET = 'e2e-bucket';
process.env.PUBLIC_ASSET_BASE_URL = 'https://cdn.e2e.test';

import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ChatRequest } from '../../src/modules/ai/llm/llm.types';
import { LLM_PROVIDERS, ProviderRegistry } from '../../src/modules/ai/llm/provider-registry';
import { FakeProvider } from '../../src/modules/ai/testing/fake-provider';
import { ImageStorage } from '../../src/modules/media/media.public';
import { Mailer } from '../../src/platform/mail';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AllExceptionsFilter } from '../../src/platform/http/all-exceptions.filter';
import { IMAGE_MAX_BYTES } from '../../src/platform/http/image-upload.constants';

/** Smallest valid PNG, so uploads are real image bytes rather than a stub. */
const pngBytes =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Checkout references the fake gateway handed out, newest last. */
const checkoutReferences: string[] = [];
const fakePaymentGateway = {
  // A unique reference per call, like the real gateway, so persisted funding
  // rows never collide on the stripePaymentIntentId unique constraint.
  createFundingCheckout: jest.fn().mockImplementation(() => {
    const reference = `cs_test_${Date.now()}_${Math.random()}`;
    checkoutReferences.push(reference);
    return Promise.resolve({ reference, url: `https://checkout.test/${reference}` });
  }),
  refundPayment: jest.fn().mockResolvedValue({ refundId: 're_test' }),
  createPayout: jest.fn().mockResolvedValue({ payoutId: 'po_test' }),
  createPayoutOnboarding: jest
    .fn()
    .mockResolvedValue({ accountId: 'acct_test', url: 'https://connect.test' }),
  isPayoutAccountReady: jest.fn().mockResolvedValue(false),
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
  sendNotification: jest.fn().mockResolvedValue(undefined),
};
/** Keeps uploads in memory so e2e never touches Cloudflare R2. */
const storedImages = new Map<string, Buffer>();
const fakeImageStorage = {
  put: jest.fn().mockImplementation((key: string, body: Buffer) => {
    storedImages.set(key, body);
    return Promise.resolve();
  }),
};
/** Answers each assistant with a valid result for its schema, streamed in two pieces. */
const fakeLlm = new FakeProvider([]);
fakeLlm.stream = async function* (request: ChatRequest) {
  fakeLlm.requests.push(request);
  const required = (request.responseSchema?.required as string[] | undefined) ?? [];
  const idea = {
    title: 'Morning routine',
    hook: 'My 6am glow secret',
    talkingPoints: ['Texture close-up', 'How it feels after a week'],
    format: '30-second talking head',
  };
  const body = required.includes('brief')
    ? {
        brief: 'Show your sneakers on a summer day out and say why they are comfortable to walk in.',
        goals: 'Get people to try the summer line.',
        audience: 'Young adults who walk a lot.',
        contentRules: ['Show the shoes in the first 3 seconds', 'Mention the comfort'],
        hashtags: ['SummerSteps', '#Sneakers'],
      }
    : { ideas: [idea, idea, idea] };
  const text = JSON.stringify(body);
  yield { type: 'delta', text: text.slice(0, 20) };
  yield { type: 'delta', text: text.slice(20) };
  yield {
    type: 'done',
    result: {
      content: text,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 50, outputTokens: 80 },
      model: request.model,
    },
  };
};

/** Splits a server-sent-events body into its JSON events. */
function sseEvents(text: string): { type: string; [key: string]: unknown }[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as { type: string });
}

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

  /** Back-office routes take a staff session, signed in by emailed code. Created once per run. */
  let staffToken: string | undefined;
  const signInAsStaff = async (): Promise<string> => {
    if (staffToken) {
      return staffToken;
    }
    const staffEmail = `staff-${runId}@test.dev`;
    await prisma.staffAccount.create({ data: { email: staffEmail, role: 'SUPER_ADMIN' } });
    const requested = await http().post('/v1/admin/auth/code').send({ email: staffEmail });
    expect(requested.status).toBe(200);
    const session = await http()
      .post('/v1/admin/auth/code/verify')
      .send({ email: staffEmail, code: sentCodes.get(staffEmail) });
    expect(session.status).toBe(200);
    staffToken = session.body.accessToken as string;
    return staffToken;
  };

  /** Plays Stripe confirming a Checkout payment, through the real webhook route. */
  const settleCheckout = async (reference: string): Promise<void> => {
    fakePaymentGateway.parseWebhookEvent.mockReturnValueOnce({
      kind: 'FUNDING_SUCCEEDED',
      reference,
    });
    const webhook = await http()
      .post('/v1/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=fake')
      .set('Content-Type', 'application/json')
      .send({ type: 'checkout.session.completed' });
    expect(webhook.status).toBe(204);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('PaymentGatewayPort')
      .useValue(fakePaymentGateway)
      .overrideProvider('BillingGatewayPort')
      .useValue(fakeBillingGateway)
      .overrideProvider(Mailer)
      .useValue(fakeMailer)
      .overrideProvider(ImageStorage)
      .useValue(fakeImageStorage)
      .overrideProvider(LLM_PROVIDERS)
      .useValue(new ProviderRegistry([fakeLlm]))
      .compile();

    // rawBody, as in main.ts, so the Stripe webhook route accepts a payload.
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
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

    // Creators may only join a campaign whose whole budget has been paid in.
    const unfunded = await http()
      .post(`/v1/campaigns/${campaignId}/publish`)
      .set(auth(brand.token));
    expect(unfunded.status).toBe(409);

    const funding = await http()
      .post(`/v1/campaigns/${campaignId}/funding`)
      .set(auth(brand.token))
      .send({ amountMinor: 500000 });
    expect(funding.status).toBe(201);
    expect(funding.body).toMatchObject({ amountMinor: 500000, status: 'PENDING' });
    const reference = checkoutReferences.at(-1) as string;
    expect(funding.body.checkoutUrl).toBe(`https://checkout.test/${reference}`);

    await settleCheckout(reference);

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
      .send({ displayName: 'Creator One', username: `creator.${runId}`, country: 'US' });
    expect(profileRes.status).toBe(201);

    // TikTok, Instagram, YouTube and Snapchat must be connected by signing in (OAuth).
    const unverified = await http()
      .post('/v1/creator-profile/social-accounts')
      .set(auth(creator.token))
      .send({ platform: 'TIKTOK', handle: 'creator.one' });
    expect(unverified.status).toBe(400);

    const socialRes = await http()
      .post('/v1/creator-profile/social-accounts')
      .set(auth(creator.token))
      .send({ platform: 'X', handle: 'creator.one' });
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

  it('reports the settled campaign funding', async () => {
    const response = await http().get(`/v1/campaigns/${campaignId}/funding`).set(auth(brand.token));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      amountMinor: 500000,
      currencyCode: 'USD',
      status: 'SUCCEEDED',
    });
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
      `${process.env.PUBLIC_ASSET_BASE_URL}/${response.body.key}`,
    );

    const stored = await prisma.mediaAsset.findUnique({ where: { id: response.body.id } });
    expect(stored).toMatchObject({ kind: 'IMAGE', status: 'READY' });

    // The bytes went to object storage under that key; serving them is the CDN's job.
    expect(storedImages.get(response.body.key)).toEqual(Buffer.from(pngBytes, 'base64'));

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
      // A creator disputes their own submission; campaign disputes are for the brand.
      .send({ subjectType: 'SUBMISSION', subjectId: submissionId, reason: 'Payout delayed.' });
    expect(open.status).toBe(201);
    disputeId = open.body.id;

    const message = await http()
      .post(`/v1/disputes/${disputeId}/messages`)
      .set(auth(creator.token))
      .send({ message: 'Any update?' });
    expect(message.status).toBe(201);
  });

  it('drafts a campaign brief as JSON and as a stream', async () => {
    const json = await http()
      .post('/v1/ai/campaign-brief')
      .set(auth(brand.token))
      .send({ idea: 'A summer campaign for sneakers.', platforms: ['TIKTOK'], language: 'en' });
    expect(json.status).toBe(200);
    expect(json.body.data.hashtags).toEqual(['#SummerSteps', '#Sneakers']);
    expect(json.body.meta).toMatchObject({ provider: 'ollama', promptVersion: 'campaign-brief@v1' });

    const stream = await http()
      .post('/v1/ai/campaign-brief/stream')
      .set(auth(brand.token))
      .send({ idea: 'A summer campaign for sneakers.' })
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => done(null, text));
      });
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    const events = sseEvents(stream.body as string);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['status', 'partial', 'result']),
    );
    expect(events.at(-1)).toMatchObject({ type: 'result', data: { goals: expect.any(String) } });

    const logged = await prisma.aiRequest.findFirst({
      where: { kind: 'campaign-brief', status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged).toMatchObject({ promptVersion: 'campaign-brief@v1', outputTokens: 80 });
  });

  it('validates assistant input and permissions', async () => {
    const tooShort = await http()
      .post('/v1/ai/campaign-brief')
      .set(auth(brand.token))
      .send({ idea: 'x' });
    expect(tooShort.status).toBe(400);

    const creatorBrief = await http()
      .post('/v1/ai/campaign-brief')
      .set(auth(creator.token))
      .send({ idea: 'A summer campaign for sneakers.' });
    expect(creatorBrief.status).toBe(403);
  });

  it('suggests content ideas for a visible campaign only', async () => {
    const createCampaign = (title: string) =>
      http()
        .post(`/v1/organizations/${organizationId}/campaigns`)
        .set(auth(brand.token))
        .send({
          title,
          description: 'Promote the summer line with outdoor walks.',
          platform: 'TIKTOK',
          visibility: 'PUBLIC',
          startDate: '2026-01-01',
          endDate: '2026-03-01',
          currencyCode: 'USD',
          budgetAmount: 100000,
          rewardType: 'FIXED_PER_ITEM',
          rewardAmount: 5000,
        });
    const live = await createCampaign('Ideas Launch');
    expect(live.status).toBe(201);
    // Published directly: funding is covered by the payments tests.
    await prisma.campaign.update({
      where: { id: live.body.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    const ideas = await http()
      .post('/v1/ai/content-ideas')
      .set(auth(creator.token))
      .send({ campaignId: live.body.id, focus: 'comedy skits' });
    expect(ideas.status).toBe(200);
    expect(ideas.body.data.ideas).toHaveLength(3);
    const task = fakeLlm.requests.at(-1)?.messages.find((message) => message.role === 'user');
    expect(task?.content).toContain('Ideas Launch');
    expect(task?.content).toContain('comedy skits');

    const draft = await createCampaign('Secret Draft');
    expect(draft.status).toBe(201);
    const hidden = await http()
      .post('/v1/ai/content-ideas/stream')
      .set(auth(creator.token))
      .send({ campaignId: draft.body.id });
    expect(hidden.status).toBe(403);
  });

  it('lets admins see and change the AI provider settings', async () => {
    const forbidden = await http().get('/v1/admin/ai/settings').set(auth(brand.token));
    expect(forbidden.status).toBe(403);

    const staff = { token: await signInAsStaff() };

    const view = await http().get('/v1/admin/ai/settings').set(auth(staff.token));
    expect(view.status).toBe(200);
    expect(view.body.active.provider).toBe('ollama');

    const models = await http()
      .get('/v1/admin/ai/providers/ollama/models')
      .set(auth(staff.token));
    expect(models.status).toBe(200);
    expect(models.body).toEqual([{ name: 'fake-model' }]);

    const saved = await http()
      .post('/v1/admin/ai/settings')
      .set(auth(staff.token))
      .send({ provider: 'ollama', model: 'fake-model' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      source: 'admin',
      active: { provider: 'ollama', model: 'fake-model' },
    });

    const unknown = await http()
      .post('/v1/admin/ai/settings')
      .set(auth(staff.token))
      .send({ provider: 'ollama', model: 'not-a-model' });
    expect(unknown.status).toBe(400);

    const test = await http().post('/v1/admin/ai/test').set(auth(staff.token));
    expect(test.status).toBe(200);
    expect(test.body.ok).toBe(true);

    const reset = await http().post('/v1/admin/ai/settings/reset').set(auth(staff.token));
    expect(reset.body.source).toBe('environment');
  });

  it('exposes admin endpoints only to staff sessions', async () => {
    const forbidden = await http().get('/v1/admin/users').set(auth(brand.token));
    expect(forbidden.status).toBe(403);

    // The ADMIN user type is retired: back-office access comes from a staff account.
    const retiredAdmin = await http().get('/v1/admin/users').set(auth(adminUser.token));
    expect(retiredAdmin.status).toBe(403);

    const staffToken = await signInAsStaff();

    // A staff session is kept to the back office.
    const notBackOffice = await http().get('/v1/me/notifications').set(auth(staffToken));
    expect(notBackOffice.status).toBe(403);

    const users = await http().get('/v1/admin/users').set(auth(staffToken));
    expect(users.status).toBe(200);

    const category = await http()
      .post('/v1/admin/campaign-categories')
      .set(auth(staffToken))
      .send({ name: `Fashion ${runId}` });
    expect(category.status).toBe(201);

    const disputes = await http().get('/v1/admin/disputes').set(auth(staffToken));
    expect(disputes.status).toBe(200);
    expect(disputes.body.some((d: { id: string }) => d.id === disputeId)).toBe(true);
  });
});
