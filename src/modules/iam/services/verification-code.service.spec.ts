import { BadRequestException } from '@nestjs/common';
import { VerificationPurpose } from '@prisma/client';
import { PasswordService } from './password.service';
import { VerificationCodeService } from './verification-code.service';

/**
 * A minimal in-memory stand-in for the single verification-code row the service
 * touches. It is enough to exercise issue → consume, attempt limiting, expiry,
 * and single-use behaviour without a database.
 */
interface Row {
  id: string;
  userId: string;
  purpose: VerificationPurpose;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

function buildPrismaFake(): { prisma: unknown; rows: () => Row[] } {
  let rows: Row[] = [];
  let seq = 0;

  const verificationCode = {
    deleteMany: jest.fn(async ({ where }: { where: Partial<Row> }) => {
      rows = rows.filter(
        (row) =>
          !(
            row.userId === where.userId &&
            row.purpose === where.purpose &&
            row.consumedAt === null
          ),
      );
      return { count: 0 };
    }),
    create: jest.fn(async ({ data }: { data: Omit<Row, 'id' | 'consumedAt' | 'attempts' | 'createdAt'> }) => {
      const row: Row = {
        id: `code_${seq++}`,
        consumedAt: null,
        attempts: 0,
        createdAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    findFirst: jest.fn(async ({ where }: { where: { userId: string; purpose: VerificationPurpose } }) => {
      const now = Date.now();
      return (
        [...rows]
          .reverse()
          .find(
            (row) =>
              row.userId === where.userId &&
              row.purpose === where.purpose &&
              row.consumedAt === null &&
              row.expiresAt.getTime() > now,
          ) ?? null
      );
    }),
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
    verificationCode,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { prisma, rows: () => rows };
}

describe('VerificationCodeService', () => {
  const passwords = new PasswordService();

  function makeService(): {
    service: VerificationCodeService;
    rows: () => Row[];
    prisma: unknown;
  } {
    const { prisma, rows } = buildPrismaFake();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new VerificationCodeService(prisma as any, passwords);
    return { service, rows, prisma };
  }

  it('issues a 6-digit code and stores only its hash', async () => {
    const { service, rows } = makeService();

    const code = await service.issue('user-1', 'EMAIL_VERIFICATION');

    expect(code).toMatch(/^\d{6}$/);
    expect(rows()[0]?.codeHash).toBeDefined();
    expect(rows()[0]?.codeHash).not.toContain(code);
  });

  it('consumes a valid code exactly once', async () => {
    const { service } = makeService();
    const code = await service.issue('user-1', 'EMAIL_VERIFICATION');

    await expect(service.consume('user-1', 'EMAIL_VERIFICATION', code)).resolves.toBeUndefined();
    // Second use fails — the code is now consumed.
    await expect(service.consume('user-1', 'EMAIL_VERIFICATION', code)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const { service, rows } = makeService();
    await service.issue('user-1', 'EMAIL_VERIFICATION');

    await expect(service.consume('user-1', 'EMAIL_VERIFICATION', '000000')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows()[0]?.attempts).toBe(1);
  });

  it('locks out after too many attempts', async () => {
    const { service } = makeService();
    const code = await service.issue('user-1', 'EMAIL_VERIFICATION');

    for (let i = 0; i < 5; i++) {
      await expect(
        service.consume('user-1', 'EMAIL_VERIFICATION', '000000'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    // Even the correct code is refused once the attempt ceiling is hit.
    await expect(service.consume('user-1', 'EMAIL_VERIFICATION', code)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('issuing a new code invalidates the previous one', async () => {
    const { service } = makeService();
    const first = await service.issue('user-1', 'EMAIL_VERIFICATION');
    await service.issue('user-1', 'EMAIL_VERIFICATION');

    await expect(service.consume('user-1', 'EMAIL_VERIFICATION', first)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
