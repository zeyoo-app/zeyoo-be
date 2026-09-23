import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Subscription } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { MembershipService, OrganizationService } from '@modules/iam/iam.public';
import { BILLING_GATEWAY, BillingGatewayPort } from '../ports/billing-gateway.port';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly memberships: MembershipService,
    private readonly config: ConfigService<Env, true>,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGatewayPort,
  ) {}

  listPlans(): Promise<Plan[]> {
    return this.prisma.plan.findMany({ orderBy: { priceMinor: 'asc' } });
  }

  async getSubscription(organizationId: string, requesterId: string): Promise<Subscription | null> {
    await this.organizations.assertMember(organizationId, requesterId);
    return this.prisma.subscription.findUnique({ where: { organizationId } });
  }

  async startCheckout(
    organizationId: string,
    requesterId: string,
    planKey: string,
  ): Promise<{ url: string }> {
    await this.memberships.assertOwner(organizationId, requesterId);
    const plan = await this.requirePurchasablePlan(planKey);

    const appUrl = this.config.get('APP_WEB_URL', { infer: true });
    const checkout = await this.gateway.createSubscriptionCheckout({
      organizationId,
      planKey,
      priceId: plan.stripePriceId as string,
      successUrl: `${appUrl}/billing/success`,
      cancelUrl: `${appUrl}/billing/cancel`,
    });
    await this.prisma.subscription.upsert({
      where: { organizationId },
      update: { planKey, status: 'INCOMPLETE' },
      create: { organizationId, planKey, status: 'INCOMPLETE' },
    });
    return checkout;
  }

  async activate(organizationId: string, stripeSubscriptionId: string): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { organizationId },
      data: { status: 'ACTIVE', stripeSubscriptionId },
    });
  }

  async cancelByStripeId(stripeSubscriptionId: string): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId },
      data: { status: 'CANCELED' },
    });
  }

  private async requirePurchasablePlan(planKey: string): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }
    if (!plan.stripePriceId) {
      throw new ConflictException('This plan is not purchasable yet.');
    }
    return plan;
  }
}
