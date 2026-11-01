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
import { FundingService } from '../application/funding.service';
import { TopUpService } from '../application/top-up.service';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';

@ApiExcludeController()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    private readonly funding: FundingService,
    private readonly topUps: TopUpService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
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
    // A Checkout payment is either a campaign funding or a wallet top-up; each handler
    // ignores references that are not its own.
    if (event.kind === 'FUNDING_SUCCEEDED') {
      await this.funding.markSucceeded(event.reference);
      await this.topUps.markSucceeded(event.reference);
    } else if (event.kind === 'FUNDING_FAILED') {
      await this.funding.markFailed(event.reference);
      await this.topUps.markFailed(event.reference);
    }
  }
}
