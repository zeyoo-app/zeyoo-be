import { ConflictException } from '@nestjs/common';
import { BillingService } from './billing.service';

interface Setup {
  subscription?: object | null;
}

function build({ subscription = null }: Setup = {}): {
  service: BillingService;
  gateway: Record<string, jest.Mock>;
  update: jest.Mock;
  upsert: jest.Mock;
} {
  const update = jest.fn().mockResolvedValue({});
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    plan: {
      findUnique: jest.fn().mockResolvedValue({ key: 'scale', stripePriceId: 'price_scale' }),
    },
    subscription: { findUnique: jest.fn().mockResolvedValue(subscription), update, upsert },
    billingPaymentMethod: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const gateway = {
    createSubscriptionCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' }),
    changeSubscriptionPrice: jest.fn().mockResolvedValue(undefined),
    cancelAtPeriodEnd: jest.fn().mockResolvedValue(new Date('2026-12-05T00:00:00Z')),
    resume: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BillingService(
    prisma as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    { assertOwner: jest.fn().mockResolvedValue(undefined) } as never,
    {
      organizationTotals: jest.fn().mockResolvedValue({
        monthlySpend: { minorUnits: 0, currency: 'USD' },
        totalFunded: { minorUnits: 0, currency: 'USD' },
        walletBalance: { minorUnits: 0, currency: 'USD' },
      }),
    } as never,
    { forOrganization: jest.fn().mockResolvedValue({ platformFeeBps: 700 }) } as never,
    { get: jest.fn().mockReturnValue('https://zeyoo.app') } as never,
    gateway as never,
  );
  return { service, gateway, update, upsert };
}

const growth = { planKey: 'growth', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAt: null };

describe('BillingService plan changes', () => {
  it('switches a paying brand in place instead of opening a second subscription', async () => {
    const { service, gateway, update } = build({ subscription: growth });

    const result = await service.startCheckout('org-1', 'owner', 'scale');

    expect(result).toEqual({ url: null, changed: true });
    expect(gateway.changeSubscriptionPrice).toHaveBeenCalledWith('sub_1', 'price_scale');
    expect(gateway.createSubscriptionCheckout).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: { planKey: 'scale', cancelAt: null },
    });
  });

  it('refuses to "change" to the plan the brand is already on', async () => {
    const { service } = build({ subscription: { ...growth, planKey: 'scale' } });

    await expect(service.startCheckout('org-1', 'owner', 'scale')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('sends a Starter brand to Stripe Checkout', async () => {
    const { service, gateway } = build();

    const result = await service.startCheckout('org-1', 'owner', 'scale');

    expect(result.url).toBe('https://checkout.stripe.com/x');
    expect(gateway.createSubscriptionCheckout).toHaveBeenCalled();
  });

  it('cancels at the end of the paid period and reports when the plan ends', async () => {
    const { service, gateway, update } = build({ subscription: growth });

    const result = await service.cancel('org-1', 'owner');

    expect(gateway.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
    expect(result.planEndsAt).toBe('2026-12-05T00:00:00.000Z');
    expect(update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: { cancelAt: new Date('2026-12-05T00:00:00Z') },
    });
  });

  it('has nothing to cancel on Starter', async () => {
    const { service } = build();

    await expect(service.cancel('org-1', 'owner')).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a cancelled plan when the brand changes their mind', async () => {
    const cancelled = { ...growth, cancelAt: new Date('2026-12-05T00:00:00Z') };
    const { service, gateway, update } = build({ subscription: cancelled });

    await service.resume('org-1', 'owner');

    expect(gateway.resume).toHaveBeenCalledWith('sub_1');
    expect(update).toHaveBeenCalledWith({ where: { organizationId: 'org-1' }, data: { cancelAt: null } });
  });

  it('shows when a cancelled plan ends in the billing summary', async () => {
    const cancelled = { ...growth, cancelAt: new Date('2026-12-05T00:00:00Z') };
    const { service } = build({ subscription: cancelled });

    const billing = await service.getBilling('org-1', 'member');

    expect(billing.plan).toBe('Growth');
    expect(billing.planEndsAt).toBe('2026-12-05T00:00:00.000Z');
  });
});
