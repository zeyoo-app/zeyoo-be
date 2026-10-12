import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';

function build(user: Record<string, unknown>): {
  controller: AdminController;
  setStatus: jest.Mock;
} {
  const setStatus = jest.fn().mockResolvedValue({});
  const controller = new AdminController(
    {} as never,
    { findById: jest.fn().mockResolvedValue({ id: 'u1', ...user }), setStatus } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { controller, setStatus };
}

const ADMIN = { userId: 'admin-1' } as never;

describe('AdminController user actions', () => {
  it('suspends an active account', async () => {
    const { controller, setStatus } = build({ type: 'CREATOR', status: 'ACTIVE' });

    await controller.suspendUser(ADMIN, 'u1');

    expect(setStatus).toHaveBeenCalledWith('u1', 'SUSPENDED');
  });

  it('refuses to suspend a staff account', async () => {
    const { controller } = build({ type: 'ADMIN', status: 'ACTIVE' });

    await expect(controller.suspendUser(ADMIN, 'u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to suspend an account that is not active', async () => {
    const { controller } = build({ type: 'CREATOR', status: 'DELETED' });

    await expect(controller.suspendUser(ADMIN, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('only reactivates a suspended account', async () => {
    const { controller } = build({ type: 'CREATOR', status: 'ACTIVE' });

    await expect(controller.reactivateUser('u1')).rejects.toBeInstanceOf(ConflictException);
  });
});
