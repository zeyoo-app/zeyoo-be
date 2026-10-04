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
    const gateway = { createFundingIntent: jest.fn() };
    const service = new FundingService(
      prisma as never,
      campaigns as never,
      organizations as never,
      ledger as never,
      config as never,
      gateway as never,
    );

    const result = await service.createForCampaign('campaign-1', 'user-1', 50_000);

    expect(result).toMatchObject({
      fundingId: 'funding-1',
      amountMinor: 50_000,
      currencyCode: 'USD',
      status: 'SUCCEEDED',
    });
    expect(result.clientSecret).toBe('bypass_funding_succeeded');
    expect(gateway.createFundingIntent).not.toHaveBeenCalled();
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
