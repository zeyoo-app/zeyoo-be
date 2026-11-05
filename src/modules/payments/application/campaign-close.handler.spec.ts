import { Campaign } from '@prisma/client';
import { CampaignCloseHandler } from './campaign-close.handler';

function build(unspent: number): {
  handler: CampaignCloseHandler;
  calls: string[];
  refundUnspent: jest.Mock;
} {
  const calls: string[] = [];
  const settleCampaignAsSystem = jest.fn(async () => {
    calls.push('settle');
  });
  const refundUnspent = jest.fn(async () => {
    calls.push('return');
  });
  const handler = new CampaignCloseHandler(
    { onClosed: jest.fn() } as never,
    { settleCampaignAsSystem } as never,
    { refundableMinor: jest.fn().mockResolvedValue(unspent), refundUnspent } as never,
  );
  return { handler, calls, refundUnspent };
}

const campaign = (currencyCode: string): Campaign => ({ id: 'c1', currencyCode }) as Campaign;

describe('CampaignCloseHandler', () => {
  it('settles creators first, then returns the rest of a USD budget to the wallet', async () => {
    const { handler, calls, refundUnspent } = build(15_000);

    await handler.returnUnspent(campaign('USD'), 'brand-user');

    expect(calls).toEqual(['settle', 'return']);
    expect(refundUnspent).toHaveBeenCalledWith('c1', 'brand-user');
  });

  it('returns nothing when creators earned the whole budget', async () => {
    const { handler, refundUnspent } = build(0);

    await handler.returnUnspent(campaign('USD'), 'brand-user');

    expect(refundUnspent).not.toHaveBeenCalled();
  });

  it('leaves campaigns in other currencies to the manual card refund', async () => {
    const { handler, calls } = build(15_000);

    await handler.returnUnspent(campaign('SAR'), 'brand-user');

    expect(calls).toEqual([]);
  });
});
