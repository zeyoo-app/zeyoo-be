import { FundingService } from './funding.service';

describe('FundingService', () => {
  it('runs normal success fulfillment without Stripe when the bypass is enabled', async () => {
    const storedFunding = {
      id: 'funding-1',
      campaignId: 'campaign-1',
      organizationId: 'organization-1',
      amount: 50_000,
      currencyCode: 'USD',
    };
    const prisma = {
      campaignFunding: {
        create: jest.fn().mockResolvedValue({ id: storedFunding.id }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(storedFunding),
      },
    };
    const campaigns = {
      requireCampaign: jest.fn().mockResolvedValue({
        id: 'campaign-1',
        organizationId: 'organization-1',
        currencyCode: 'USD',
      }),
    };
    const organizations = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const ledger = { recordFunding: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue(true) };
    const gateway = { createFundingCheckout: jest.fn() };
    const service = new FundingService(
      prisma as never,
      campaigns as never,
      organizations as never,
      ledger as never,
      { forOrganization: jest.fn().mockResolvedValue({ platformFeeBps: 1000 }) } as never,
      config as never,
      gateway as never,
    );

    const result = await service.createForCampaign('campaign-1', 'user-1', 50_000, 'web');

    expect(result).toMatchObject({
      fundingId: 'funding-1',
      amountMinor: 50_000,
      currencyCode: 'USD',
      status: 'SUCCEEDED',
    });
    expect(result.checkoutUrl).toBeNull();
    expect(gateway.createFundingCheckout).not.toHaveBeenCalled();
    expect(prisma.campaignFunding.updateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: expect.stringMatching(/^bypass_/), status: 'PENDING' },
      data: { status: 'SUCCEEDED' },
    });
    expect(ledger.recordFunding).toHaveBeenCalledWith(
      'organization-1',
      expect.objectContaining({ amountMinor: 50_000, currencyCode: 'USD' }),
      'funding-1',
    );
  });
});

describe('FundingService with Stripe Checkout', () => {
  function build(): {
    service: FundingService;
    createFundingCheckout: jest.Mock;
    create: jest.Mock;
  } {
    const create = jest.fn().mockResolvedValue({ id: 'funding-1' });
    const createFundingCheckout = jest.fn().mockResolvedValue({
      reference: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });
    const config = {
      get: jest.fn((key: string) =>
        key === 'APP_WEB_URL'
          ? 'https://www.zeyoo.app/'
          : key === 'PAYMENTS_BYPASS_STRIPE'
            ? false
            : undefined,
      ),
    };
    const service = new FundingService(
      {
        campaignFunding: {
          create,
          findFirst: jest.fn().mockResolvedValue({
            id: 'funding-1',
            amount: 50_000,
            feeAmount: 5_000,
            currencyCode: 'USD',
            status: 'PENDING',
          }),
        },
      } as never,
      {
        requireCampaign: jest.fn().mockResolvedValue({
          id: 'campaign-1',
          title: 'Summer',
          organizationId: 'org-1',
          currencyCode: 'USD',
        }),
      } as never,
      { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      { forOrganization: jest.fn().mockResolvedValue({ platformFeeBps: 1000 }) } as never,
      config as never,
      { createFundingCheckout } as never,
    );
    return { service, createFundingCheckout, create };
  }

  it('sends the brand to Stripe Checkout and keeps the funding pending', async () => {
    const { service, createFundingCheckout, create } = build();

    const result = await service.createForCampaign('campaign-1', 'user-1', 50_000, 'app');

    expect(result).toMatchObject({
      status: 'PENDING',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });
    expect(create.mock.calls[0][0].data.stripePaymentIntentId).toBe('cs_test_123');
    expect(create.mock.calls[0][0].data.feeAmount).toBe(5_000);
    expect(createFundingCheckout.mock.calls[0][0]).toMatchObject({
      amountMinor: 50_000,
      feeMinor: 5_000,
      feeLabel: 'Zeyoo platform fee (10%)',
      currencyCode: 'USD',
      successUrl:
        'https://www.zeyoo.app/app-return?to=%2Fbrand%2Fcampaigns%2Fcampaign-1%3Ffunding%3Dpaid',
      cancelUrl:
        'https://www.zeyoo.app/app-return?to=%2Fbrand%2Fcampaigns%2Fcampaign-1%3Ffunding%3Dcancelled',
    });
  });

  it('reports the latest funding status for polling', async () => {
    const { service } = build();

    const latest = await service.latestForCampaign('campaign-1', 'user-1');

    expect(latest).toEqual({
      fundingId: 'funding-1',
      amountMinor: 50_000,
      feeMinor: 5_000,
      currencyCode: 'USD',
      status: 'PENDING',
    });
  });
});
