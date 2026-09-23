import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '@platform/auth';
import { BILLING_GATEWAY, BillingGatewayPort } from '../ports/billing-gateway.port';
import { BillingService } from '../services/billing.service';

@ApiExcludeController()
@Controller('webhooks/stripe/billing')
export class BillingWebhookController {
  constructor(
    private readonly billing: BillingService,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGatewayPort,
  ) {}

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post()
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<void> {
    if (!request.rawBody || !signature) {
      throw new BadRequestException('Missing webhook payload or signature.');
    }
    const event = this.gateway.parseWebhookEvent(request.rawBody, signature);
    if (event.kind === 'SUBSCRIPTION_ACTIVATED') {
      await this.billing.activate(event.organizationId, event.stripeSubscriptionId);
    } else if (event.kind === 'SUBSCRIPTION_CANCELED') {
      await this.billing.cancelByStripeId(event.stripeSubscriptionId);
    }
  }
}
