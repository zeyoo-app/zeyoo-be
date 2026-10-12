import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';

const ZERO = { minorUnits: 0, currency: 'USD' };

interface Setup {
  user?: { id: string; status: string } | null;
  wallet?: Partial<
    Record<'available' | 'pending' | 'held', { minorUnits: number; currency: string }>
  >;
  hasLiveCampaigns?: boolean;
}

function build({
  user = { id: 'user-1', status: 'ACTIVE' },
  wallet = {},
  hasLiveCampaigns = false,
}: Setup = {}): {
  service: AccountDeletionService;
  steps: string[];
} {
  const steps: string[] = [];
  const record = (name: string): jest.Mock =>
    jest.fn().mockImplementation(async () => void steps.push(name));
  const service = new AccountDeletionService(
    { findById: jest.fn().mockResolvedValue(user), anonymize: record('user') } as never,
    { listForUser: jest.fn().mockResolvedValue([{ id: 'org-1' }]) } as never,
    { hasLiveCampaigns: jest.fn().mockResolvedValue(hasLiveCampaigns) } as never,
    {
      getWallet: jest
        .fn()
        .mockResolvedValue({ available: ZERO, pending: ZERO, held: ZERO, ...wallet }),
    } as never,
    { anonymize: record('profile') } as never,
    { deleteAllFor: record('notifications') } as never,
    { disconnectAll: record('connections') } as never,
  );
  return { service, steps };
}

describe('AccountDeletionService', () => {
  it('erases personal data module by module and anonymizes the user last', async () => {
    const { service, steps } = build();

    await service.deleteAccount('user-1');

    expect(steps).toEqual(['profile', 'connections', 'notifications', 'user']);
  });

  it('refuses while the creator still has money in their wallet', async () => {
    const { service, steps } = build({
      wallet: { available: { minorUnits: 500, currency: 'USD' } },
    });

    await expect(service.deleteAccount('user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(steps).toEqual([]);
  });

  it('refuses while a withdrawal is still in progress', async () => {
    const { service } = build({ wallet: { pending: { minorUnits: 100, currency: 'USD' } } });

    await expect(service.deleteAccount('user-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses while the brand has live campaigns', async () => {
    const { service, steps } = build({ hasLiveCampaigns: true });

    await expect(service.deleteAccount('user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(steps).toEqual([]);
  });

  it('reports an account that is already deleted as not found', async () => {
    const { service } = build({ user: { id: 'user-1', status: 'DELETED' } });

    await expect(service.deleteAccount('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
