import { ConflictException } from '@nestjs/common';
import { StaffService } from './staff.service';

interface Setup {
  existing?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  activeSuperAdmins?: number;
}

function build({
  existing = null,
  target = { id: 't1', role: 'SUPER_ADMIN', status: 'ACTIVE' },
  activeSuperAdmins = 2,
}: Setup = {}): { service: StaffService; create: jest.Mock; transaction: jest.Mock } {
  const create = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));
  const transaction = jest.fn().mockResolvedValue([]);
  const prisma = {
    staffAccount: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) => Promise.resolve(where.email ? existing : target)),
      create,
      count: jest.fn().mockResolvedValue(activeSuperAdmins),
      update: jest.fn().mockResolvedValue({}),
    },
    staffRefreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: transaction,
  };
  return { service: new StaffService(prisma as never), create, transaction };
}

describe('StaffService', () => {
  it('adds a staff account under a normalized email', async () => {
    const { service, create } = build();

    await service.add('  New@Zeyoo.com ', 'SUPER_ADMIN', 'adder');

    expect(create).toHaveBeenCalledWith({
      data: { email: 'new@zeyoo.com', role: 'SUPER_ADMIN', addedById: 'adder' },
    });
  });

  it('refuses an email that already has staff access', async () => {
    const { service, create } = build({ existing: { id: 's1' } });

    await expect(service.add('a@zeyoo.com', 'SUPER_ADMIN', 'adder')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('will not remove your own access', async () => {
    const { service } = build();

    await expect(service.deactivate('t1', 't1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps at least one active super admin', async () => {
    const { service, transaction } = build({ activeSuperAdmins: 1 });

    await expect(service.deactivate('t1', 'me')).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('deactivates another staff account and ends its sessions', async () => {
    const { service, transaction } = build();

    await service.deactivate('t1', 'me');

    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
