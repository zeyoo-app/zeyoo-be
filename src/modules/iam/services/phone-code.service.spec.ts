import { BadRequestException } from '@nestjs/common';
import { TooManyRequestsException } from '@platform/http/too-many-requests.exception';
import { PasswordService } from './password.service';
import { PhoneCodeService } from './phone-code.service';

const PHONE = '+15551234567';

/**
 * A minimal in-memory stand-in for the phone-code table the service touches. It
 * is enough to exercise issue → consume, attempt limiting, expiry, single-use
 * behaviour, and the send throttle without a database.
 */
interface Row {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

function buildPrismaFake(): { prisma: unknown; rows: () => Row[] } {
  let rows: Row[] = [];
  let seq = 0;

  const phoneVerificationCode = {
    deleteMany: jest.fn(
      async ({ where }: { where: { phone: string; OR: { consumedAt?: { not: null }; expiresAt?: { lte: Date } }[] } }) => {
        rows = rows.filter((row) => {
          if (row.phone !== where.phone) return true;
          const spent = row.consumedAt !== null;
          const expired = row.expiresAt.getTime() <= Date.now();
          return !(spent || expired);
        });
        return { count: 0 };
      },
    ),
    create: jest.fn(
      async ({ data }: { data: Omit<Row, 'id' | 'consumedAt' | 'attempts' | 'createdAt'> }) => {
        const row: Row = { id: `code_${seq++}`, consumedAt: null, attempts: 0, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
    ),
    count: jest.fn(async ({ where }: { where: { phone: string; createdAt: { gte: Date } } }) => {
        const since = where.createdAt.gte.getTime();
      return rows.filter((row) => row.phone === where.phone && row.createdAt.getTime() >= since).length;
    }),
    findFirst: jest.fn(
      async ({
        where,
        select,
      }: {
        where: { phone: string; createdAt?: { gte: Date }; consumedAt?: null; expiresAt?: { gt: Date } };
        select?: { createdAt: true };
      }) => {
        const candidates = rows
          .filter((row) => row.phone === where.phone)
          .filter((row) => (where.createdAt ? row.createdAt.getTime() >= where.createdAt.gte.getTime() : true))
          .filter((row) => (where.consumedAt === null ? row.consumedAt === null : true))
          .filter((row) => (where.expiresAt ? row.expiresAt.getTime() > Date.now() : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const found = candidates[0] ?? null;
        return found && select?.createdAt ? { createdAt: found.createdAt } : found;
      },
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { attempts?: { increment: number }; consumedAt?: Date };
      }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('row not found');
        if (data.attempts) row.attempts += data.attempts.increment;
        if (data.consumedAt) row.consumedAt = data.consumedAt;
        return row;
      },
    ),
  };

  const prisma = {
    phoneVerificationCode,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { prisma, rows: () => rows };
}

describe('PhoneCodeService', () => {
  const passwords = new PasswordService();

  function makeService(): { service: PhoneCodeService; rows: () => Row[] } {
    const { prisma, rows } = buildPrismaFake();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service: new PhoneCodeService(prisma as any, passwords), rows };
  }

  it('issues a 6-digit code and stores only its hash', async () => {
    const { service, rows } = makeService();

    const code = await service.issue(PHONE);

    expect(code).toMatch(/^\d{6}$/);
    expect(rows()[0]?.codeHash).toBeDefined();
    expect(rows()[0]?.codeHash).not.toContain(code);
  });

  it('consumes a valid code exactly once', async () => {
    const { service } = makeService();
    const code = await service.issue(PHONE);

    await expect(service.consume(PHONE, code)).resolves.toBeUndefined();
    await expect(service.consume(PHONE, code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not accept a code issued for a different number', async () => {
    const { service } = makeService();
    const code = await service.issue(PHONE);

    await expect(service.consume('+15559999999', code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const { service, rows } = makeService();
    await service.issue(PHONE);

    await expect(service.consume(PHONE, '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(rows()[0]?.attempts).toBe(1);
  });

  it('locks out after too many attempts', async () => {
    const { service } = makeService();
    const code = await service.issue(PHONE);

    for (let i = 0; i < 5; i++) {
      await expect(service.consume(PHONE, '000000')).rejects.toBeInstanceOf(BadRequestException);
    }
    // Even the correct code is refused once the attempt ceiling is hit.
    await expect(service.consume(PHONE, code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const { service, rows } = makeService();
    const code = await service.issue(PHONE);
    rows()[0]!.expiresAt = new Date(Date.now() - 1000);

    await expect(service.consume(PHONE, code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('issuing a new code invalidates the previous one', async () => {
    const { service, rows } = makeService();
    const first = await service.issue(PHONE);
    // Clear the resend cooldown so the second send is allowed.
    rows()[0]!.createdAt = new Date(Date.now() - 10 * 60 * 1000);
    await service.issue(PHONE);

    await expect(service.consume(PHONE, first)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throttles a second code to the same number', async () => {
    const { service } = makeService();
    await service.issue(PHONE);

    await expect(service.issue(PHONE)).rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('caps messages to one number per day', async () => {
    const { service, rows } = makeService();
    // Age each send past the resend cooldown but inside the 24-hour window, so
    // only the daily ceiling can be what stops the eleventh message.
    for (let i = 0; i < 10; i++) {
      await service.issue(PHONE);
      rows()[i]!.createdAt = new Date(Date.now() - (i + 1) * 5 * 60 * 1000);
    }

    await expect(service.issue(PHONE)).rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('does not throttle a different number', async () => {
    const { service } = makeService();
    await service.issue(PHONE);

    await expect(service.issue('+15559999999')).resolves.toMatch(/^\d{6}$/);
  });
});
