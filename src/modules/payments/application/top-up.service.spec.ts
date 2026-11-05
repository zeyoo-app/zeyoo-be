import { BadRequestException } from '@nestjs/common';
import { TopUpService } from './top-up.service';

function build({ bypass = false }: { bypass?: boolean } = {}): {
  service: TopUpService;
  createCheckout: jest.Mock;
  recordTopUp: jest.Mock;
  updateMany: jest.Mock;
} {
  const createCheckout = jest
    .fn()
    .mockResolvedValue({ reference: 'cs_test_top', url: 'https://checkout.stripe.com/c/pay/cs_test_top' });
  const recordTopUp = jest.fn().mockResolvedValue(undefined);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    walletTopUp: {
      create: jest.fn().mockResolvedValue({ id: 'top-1' }),
      updateMany,
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'top-1', organizationId: 'org-1', amount: 10_000, currencyCode: 'USD' }),
    },
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'APP_WEB_URL' ? 'https://zeyoo.app' : key === 'PAYMENTS_BYPASS_STRIPE' ? bypass : undefined,
    ),
  };
  const service = new TopUpService(
    prisma as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    { recordTopUp } as never,
    config as never,
    { createFundingCheckout: createCheckout } as never,
  );
  return { service, createCheckout, recordTopUp, updateMany };
}

describe('TopUpService', () => {
  it('opens Stripe Checkout for a USD top-up, returning the app to its wallet', async () => {
    const { service, createCheckout, recordTopUp } = build();

    const result = await service.create('org-1', 'user-1', 10_000, 'app');

    expect(result).toMatchObject({ status: 'PENDING', amountMinor: 10_000, currencyCode: 'USD' });
    expect(createCheckout.mock.calls[0][0]).toMatchObject({
      amountMinor: 10_000,
      feeMinor: 0,
      currencyCode: 'USD',
      successUrl: 'https://zeyoo.app/app-return?to=%2Fbrand%2Fwallet%3Ftopup%3Dsuccess',
    });
    // Nothing is credited until Stripe confirms the payment.
    expect(recordTopUp).not.toHaveBeenCalled();
  });

  it('refuses amounts under the $50 minimum', async () => {
    const { service, createCheckout } = build();

    await expect(service.create('org-1', 'user-1', 4_999, 'web')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it('credits the wallet once when Stripe confirms, and ignores repeats', async () => {
    const { service, recordTopUp, updateMany } = build();

    await service.markSucceeded('cs_test_top');
    updateMany.mockResolvedValue({ count: 0 });
    await service.markSucceeded('cs_test_top');

    expect(recordTopUp).toHaveBeenCalledTimes(1);
    expect(recordTopUp).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ amountMinor: 10_000, currencyCode: 'USD' }),
      'top-1',
    );
  });

  it('settles at once without Stripe in bypass mode', async () => {
    const { service, createCheckout, recordTopUp } = build({ bypass: true });

    const result = await service.create('org-1', 'user-1', 10_000, 'web');

    expect(result.status).toBe('SUCCEEDED');
    expect(createCheckout).not.toHaveBeenCalled();
    expect(recordTopUp).toHaveBeenCalled();
  });
});
