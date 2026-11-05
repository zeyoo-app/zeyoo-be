import { ConflictException } from '@nestjs/common';
import { RefundService } from './refund.service';

interface Setup {
  status?: string;
  funded?: number;
  refunded?: number;
  accrued?: number;
  fundings?: { id: string; amount: number; stripePaymentIntentId: string }[];
  bypass?: boolean;
  gatewayFails?: boolean;
  /** USD campaigns return to the wallet; other currencies are refunded to the card. */
  currencyCode?: string;
}

function build({
  status = 'CLOSED',
  funded = 20_000,
  refunded = 0,
  accrued = 5_000,
  fundings = [{ id: 'f1', amount: 20_000, stripePaymentIntentId: 'cs_test_1' }],
  bypass = false,
  gatewayFails = false,
  currencyCode = 'SAR',
}: Setup = {}): {
  service: RefundService;
  refundPayment: jest.Mock;
  recordRefund: jest.Mock;
  recordReturnToWallet: jest.Mock;
  notify: jest.Mock;
  created: jest.Mock;
  updated: jest.Mock;
} {
  const created = jest.fn().mockImplementation(async ({ data }) => ({ id: 'r1', ...data }));
  const updated = jest.fn().mockResolvedValue({});
  const sumFor = (value: number) =>
    jest.fn().mockResolvedValue({ _sum: { amount: value, accruedAmount: value } });
  const prisma = {
    campaignFunding: {
      aggregate: sumFor(funded),
      findMany: jest.fn().mockResolvedValue(
        fundings.map((f) => ({
          ...f,
          campaignId: 'c1',
          organizationId: 'o1',
          currencyCode,
        })),
      ),
    },
    campaignRefund: { aggregate: sumFor(refunded), create: created, update: updated },
    creatorEarning: { aggregate: sumFor(accrued) },
  };
  const refundPayment = gatewayFails
    ? jest.fn().mockRejectedValue(new Error('stripe down'))
    : jest.fn().mockResolvedValue({ refundId: 're_1' });
  const recordRefund = jest.fn().mockResolvedValue(undefined);
  const recordReturnToWallet = jest.fn().mockResolvedValue(undefined);
  const notify = jest.fn().mockResolvedValue(undefined);
  const service = new RefundService(
    prisma as never,
    {
      requireCampaign: jest.fn().mockResolvedValue({
        id: 'c1',
        title: 'Summer',
        status,
        currencyCode,
        createdByUserId: 'u1',
      }),
    } as never,
    { recordRefund, recordReturnToWallet } as never,
    { notify } as never,
    { get: jest.fn().mockReturnValue(bypass) } as never,
    { refundPayment } as never,
  );
  return { service, refundPayment, recordRefund, recordReturnToWallet, notify, created, updated };
}

describe('RefundService', () => {
  it('refunds funded minus creator earnings through Stripe and the ledger', async () => {
    const { service, refundPayment, recordRefund } = build();

    const outcome = await service.refundUnspent('c1', 'admin-1');

    expect(outcome.refundedMinor).toBe(15_000);
    expect(refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'cs_test_1', amountMinor: 15_000 }),
    );
    expect(recordRefund).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ amountMinor: 15_000 }),
      'r1',
    );
  });

  it('will not refund a campaign that is still live', async () => {
    const { service, refundPayment } = build({ status: 'PUBLISHED' });

    await expect(service.refundUnspent('c1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('has nothing to refund once the budget is spent or already refunded', async () => {
    const { service } = build({ funded: 20_000, accrued: 5_000, refunded: 15_000 });

    await expect(service.refundUnspent('c1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks the refund failed and posts nothing when Stripe fails', async () => {
    const { service, recordRefund, updated } = build({ gatewayFails: true });

    await expect(service.refundUnspent('c1', 'admin-1')).rejects.toThrow('stripe down');

    expect(recordRefund).not.toHaveBeenCalled();
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED' } }));
  });

  it('skips Stripe in bypass mode but still posts the ledger', async () => {
    const { service, refundPayment, recordRefund } = build({ bypass: true });

    await service.refundUnspent('c1', 'admin-1');

    expect(refundPayment).not.toHaveBeenCalled();
    expect(recordRefund).toHaveBeenCalled();
  });

  it('returns a USD campaign\'s unspent budget to the wallet, not the card', async () => {
    const { service, refundPayment, recordRefund, recordReturnToWallet, created, notify } = build({
      currencyCode: 'USD',
    });

    const outcome = await service.refundUnspent('c1', 'admin-1');

    expect(outcome.refundedMinor).toBe(15_000);
    expect(refundPayment).not.toHaveBeenCalled();
    expect(recordRefund).not.toHaveBeenCalled();
    expect(recordReturnToWallet).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ amountMinor: 15_000, currencyCode: 'USD' }),
      'r1',
    );
    // Recorded as a settled refund so the same budget can never go back twice.
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Unspent budget back in your wallet', link: '/brand/wallet' }),
    );
  });
});
