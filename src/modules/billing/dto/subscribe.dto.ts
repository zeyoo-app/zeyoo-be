import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Which client opened the hosted Stripe page: decides where Stripe sends the person back.
const returnClient = z.enum(['web', 'app']).default('web');

export const subscribeSchema = z.object({
  planKey: z.string().min(1),
  client: returnClient,
});

export class SubscribeDto extends createZodDto(subscribeSchema) {}

export const hostedFlowSchema = z.object({ client: returnClient });

/** Body of a request that opens a hosted Stripe page; the body itself is optional. */
export class HostedFlowDto extends createZodDto(hostedFlowSchema) {}
