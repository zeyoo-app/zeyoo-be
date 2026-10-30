import { EntitlementsService } from './entitlements.service';

function build(
  subscription: unknown,
  plan: unknown,
): { service: EntitlementsService; prisma: { plan: { findUnique: jest.Mock } } } {
  const prisma = {
    subscription: { findUnique: jest.fn().mockResolvedValue(subscription) },
    plan: { findUnique: jest.fn().mockResolvedValue(plan) },
  };
  return { service: new EntitlementsService(prisma as never), prisma };
}

describe('EntitlementsService', () => {
  it('puts an organization without an active subscription on Starter', async () => {
    const { service, prisma } = build({ planKey: 'scale', status: 'INCOMPLETE' }, null);

    const plan = await service.forOrganization('org-1');

    expect(prisma.plan.findUnique).toHaveBeenCalledWith({ where: { key: 'starter' } });
    expect(plan).toEqual({
      planKey: 'starter',
      maxActiveCampaigns: 1,
      platformFeeBps: 1000,
      allowsPrivateCampaigns: false,
    });
  });

  it('reads the active plan from the plans table', async () => {
    const { service } = build(
      { planKey: 'growth', status: 'ACTIVE' },
      { key: 'growth', maxActiveCampaigns: 5, platformFeeBps: 700, allowsPrivateCampaigns: true },
    );

    await expect(service.forOrganization('org-1')).resolves.toMatchObject({
      planKey: 'growth',
      maxActiveCampaigns: 5,
      platformFeeBps: 700,
    });
  });

  it('computes the fee in basis points, rounded to the minor unit', () => {
    expect(EntitlementsService.feeMinor(100_000, 1000)).toBe(10_000);
    expect(EntitlementsService.feeMinor(333, 700)).toBe(23);
  });
});
