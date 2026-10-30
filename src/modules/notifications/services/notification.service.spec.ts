import { NotificationService } from './notification.service';

interface Setup {
  pushEnabled?: boolean | null;
  tokens?: string[];
  invalidTokens?: string[];
  createFails?: boolean;
  payoutUpdates?: boolean;
  emailEnabled?: boolean;
  email?: string | null;
  mailFails?: boolean;
}

function build({
  pushEnabled = true,
  tokens = ['ExponentPushToken[a]'],
  invalidTokens = [],
  createFails = false,
  payoutUpdates = true,
  emailEnabled = true,
  email = 'creator@example.com',
  mailFails = false,
}: Setup = {}): {
  service: NotificationService;
  send: jest.Mock;
  deleteTokens: jest.Mock;
  create: jest.Mock;
  sendNotification: jest.Mock;
} {
  const create = createFails
    ? jest.fn().mockRejectedValue(new Error('db down'))
    : jest.fn().mockResolvedValue({ id: 'n-1' });
  const deleteTokens = jest.fn().mockResolvedValue({ count: invalidTokens.length });
  const send = jest.fn().mockResolvedValue(invalidTokens);
  const sendNotification = mailFails
    ? jest.fn().mockRejectedValue(new Error('mail down'))
    : jest.fn().mockResolvedValue(undefined);
  const prisma = {
    notification: { create },
    notificationPreference: {
      findUnique: jest.fn().mockResolvedValue(
        pushEnabled === null
          ? null
          : {
              pushEnabled,
              emailEnabled,
              submissionUpdates: true,
              payoutUpdates,
              campaignInvites: true,
              productNews: false,
            },
      ),
    },
    user: { findUnique: jest.fn().mockResolvedValue(email ? { email } : null) },
    deviceToken: {
      findMany: jest.fn().mockResolvedValue(tokens.map((token) => ({ token }))),
      deleteMany: deleteTokens,
    },
  };
  return {
    service: new NotificationService(
      prisma as never,
      { send } as never,
      { sendNotification } as never,
      { get: jest.fn().mockReturnValue('https://zeyoo.app') } as never,
    ),
    send,
    deleteTokens,
    create,
    sendNotification,
  };
}

const NOTIFICATION = {
  userId: 'user-1',
  type: 'EARNING_CREDITED',
  title: 'You earned $5',
  body: 'Nice.',
};

describe('NotificationService.notify', () => {
  it('records the notification and pushes it to the user devices', async () => {
    const { service, send } = build();

    await service.notify(NOTIFICATION);

    expect(send).toHaveBeenCalledWith(
      ['ExponentPushToken[a]'],
      expect.objectContaining({ title: 'You earned $5' }),
    );
  });

  it('does not push when the user turned push notifications off', async () => {
    const { service, send, create } = build({ pushEnabled: false });

    await service.notify(NOTIFICATION);

    expect(create).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('pushes by default for a user who never set preferences', async () => {
    const { service, send } = build({ pushEnabled: null });

    await service.notify(NOTIFICATION);

    expect(send).toHaveBeenCalled();
  });

  it('drops device tokens the push provider reports as unregistered', async () => {
    const { service, deleteTokens } = build({ invalidTokens: ['ExponentPushToken[a]'] });

    await service.notify(NOTIFICATION);

    expect(deleteTokens).toHaveBeenCalledWith({
      where: { token: { in: ['ExponentPushToken[a]'] } },
    });
  });

  it('never throws, so a failed notification cannot undo the action that raised it', async () => {
    const { service } = build({ createFails: true });

    await expect(service.notify(NOTIFICATION)).resolves.toBeUndefined();
  });

  it('raises nothing when the category is switched off', async () => {
    const { service, send, create } = build({ payoutUpdates: false });

    await service.notify(NOTIFICATION);

    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('still raises types that belong to no switchable category', async () => {
    const { service, create } = build({ payoutUpdates: false });

    await service.notify({ ...NOTIFICATION, type: 'SYSTEM_NOTICE' });

    expect(create).toHaveBeenCalled();
  });
});

describe('NotificationService.notify by email', () => {
  it('emails the user the notification', async () => {
    const { service, sendNotification } = build();

    await service.notify(NOTIFICATION);

    expect(sendNotification).toHaveBeenCalledWith('creator@example.com', 'You earned $5', 'Nice.', {
      label: 'View wallet',
      url: 'https://zeyoo.app/notifications',
    });
  });

  it('links the email button and the push to the page the notification is about', async () => {
    const { service, sendNotification, send } = build();

    await service.notify({ ...NOTIFICATION, link: '/creator/wallet' });

    expect(sendNotification).toHaveBeenCalledWith(
      'creator@example.com',
      'You earned $5',
      'Nice.',
      { label: 'View wallet', url: 'https://zeyoo.app/creator/wallet' },
    );
    expect(send).toHaveBeenCalledWith(
      ['ExponentPushToken[a]'],
      expect.objectContaining({ data: { type: 'EARNING_CREDITED', link: '/creator/wallet' } }),
    );
  });

  it('does not email when the user turned email notifications off', async () => {
    const { service, sendNotification } = build({ emailEnabled: false });

    await service.notify(NOTIFICATION);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips the email for an account with no email address (phone sign-in)', async () => {
    const { service, sendNotification } = build({ email: null });

    await service.notify(NOTIFICATION);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('still pushes when the email cannot be sent', async () => {
    const { service, send } = build({ mailFails: true });

    await service.notify(NOTIFICATION);

    expect(send).toHaveBeenCalled();
  });
});
