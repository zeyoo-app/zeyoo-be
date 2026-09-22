import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const createFundingSchema = z.object({
  amountMinor: z.number().int().positive(),
});

export const requestWithdrawalSchema = z.object({
  amountMinor: z.number().int().positive(),
  currencyCode: z.string().regex(CURRENCY_PATTERN, 'Must be a 3-letter ISO currency code.'),
});

export const holdWithdrawalSchema = z.object({
  reason: z.string().min(1).max(500),
});

export class CreateFundingDto extends createZodDto(createFundingSchema) {}
export class RequestWithdrawalDto extends createZodDto(requestWithdrawalSchema) {}
export class HoldWithdrawalDto extends createZodDto(holdWithdrawalSchema) {}
