import { ConflictException } from '@nestjs/common';
import { AdminPeopleService } from './admin-people.service';

interface Setup {
  existing?: Record<string, unknown> | null;
  hasProfile?: number;
  hasMembership?: number;
  activeAdmins?: number;
  target?: Record<string, unknown>;
}

function build({
  existing = null,
  hasProfile = 0,
  hasMembership = 0,
  activeAdmins = 2,
  target = { id: 't1', type: 'ADMIN', status: 'ACTIVE' },
}: Setup = {}): {
  service: AdminPeopleService;
  createWithEmail: jest.Mock;
  setType: jest.Mock;
  setStatus: jest.Mock;
} {
  const createWithEmail = jest
    .fn()
    .mockResolvedValue({ id: 'new', email: 'n@x.co', status: 'ACTIVE', createdAt: new Date() });
  const setType = jest.fn().mockResolvedValue({ id: 'u1' });
  const setStatus = jest
    .fn()
    .mockResolvedValue({ id: 'u1', email: 'a@x.co', status: 'ACTIVE', createdAt: new Date() });
  const users = {
    findByEmail: jest.fn().mockResolvedValue(existing),
    findById: jest.fn().mockResolvedValue(target),
    createWithEmail,
    setType,
    setStatus,
  };
  const prisma = {
    creatorProfile: { count: jest.fn().mockResolvedValue(hasProfile) },
    membership: { count: jest.fn().mockResolvedValue(hasMembership) },
    user: { count: jest.fn().mockResolvedValue(activeAdmins) },
  };
  const service = new AdminPeopleService(prisma as never, users as never, {} as never, {} as never);
  return { service, createWithEmail, setType, setStatus };
}

describe('AdminPeopleService staff access', () => {
  it('creates a staff account for a new email', async () => {
    const { service, createWithEmail } = build();

    await service.addStaff('  New@X.co ');

    expect(createWithEmail).toHaveBeenCalledWith({ email: 'new@x.co', type: 'ADMIN' });
  });

  it('refuses an email that already belongs to a creator or brand', async () => {
    const { service, setType } = build({
      existing: { id: 'u1', type: 'CREATOR' },
      hasProfile: 1,
    });

    await expect(service.addStaff('a@x.co')).rejects.toBeInstanceOf(ConflictException);
    expect(setType).not.toHaveBeenCalled();
  });

  it('promotes an existing account that has no creator or brand role', async () => {
    const { service, setType } = build({ existing: { id: 'u1', type: 'BRAND_USER' } });

    await service.addStaff('a@x.co');

    expect(setType).toHaveBeenCalledWith('u1', 'ADMIN');
  });

  it('will not remove your own access', async () => {
    const { service } = build({ target: { id: 'me', type: 'ADMIN', status: 'ACTIVE' } });

    await expect(service.deactivateStaff('me', 'me')).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps at least one active staff account', async () => {
    const { service, setStatus } = build({ activeAdmins: 1 });

    await expect(service.deactivateStaff('t1', 'someone')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('deactivates another staff account', async () => {
    const { service, setStatus } = build();

    await service.deactivateStaff('t1', 'someone');

    expect(setStatus).toHaveBeenCalledWith('t1', 'SUSPENDED');
  });
});
