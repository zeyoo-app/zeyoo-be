import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Subscription } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { MembershipService, OrganizationService } from '@modules/iam/iam.public';
import { WalletService } from '@modules/payments/payments.public';
import { BILLING_GATEWAY, BillingGatewayPort } from '../ports/billing-gateway.port';

export type BillingPlanLabel = 'Starter' | 'Growth' | 'Scale';

export interface BrandBillingView {
  plan: BillingPlanLabel;
  monthlySpend: { minorUnits: number; currency: string };
  totalFunded: { minorUnits: number; currency: string };
  paymentMethodLast4?: string;
}

const PLAN_LABELS: Record<string, BillingPlanLabel> = {
  starter: 'Starter',
  growth: 'Growth',
  scale: 'Scale',
};

/** A brand with no active subscription is on the free Starter tier. */
function planLabel(planKey: string | null): BillingPlanLabel {
  return (planKey && PLAN_LABELS[planKey.toLowerCase()]) || 'Starter';
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly memberships: MembershipService,
    private readonly wallet: WalletService,
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
      successUrl: `${appUrl}/brand/subscription?checkout=success`,
      cancelUrl: `${appUrl}/brand/subscription?checkout=cancel`,
    });
    await this.prisma.subscription.upsert({
      where: { organizationId },
      update: { planKey, status: 'INCOMPLETE' },
      create: { organizationId, planKey, status: 'INCOMPLETE' },
    });
    return checkout;
  }

  /** The brand billing summary shown on the subscription and wallet screens. */
  async getBilling(organizationId: string, requesterId: string): Promise<BrandBillingView> {
    await this.organizations.assertMember(organizationId, requesterId);
    const [subscription, paymentMethod, totals] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId } }),
      this.prisma.billingPaymentMethod.findUnique({ where: { organizationId } }),
      this.wallet.organizationTotals(organizationId),
    ]);
    const active = subscription?.status === 'ACTIVE' ? subscription.planKey : null;
    return {
      plan: planLabel(active),
      monthlySpend: totals.monthlySpend,
      totalFunded: totals.totalFunded,
      paymentMethodLast4: paymentMethod?.last4,
    };
  }

  /** Starts the hosted card-save flow; the client opens the returned URL. */
  async startCardSetup(organizationId: string, requesterId: string): Promise<{ url: string }> {
    await this.memberships.assertOwner(organizationId, requesterId);
    const appUrl = this.config.get('APP_WEB_URL', { infer: true });
    return this.gateway.createCardSetupCheckout({
      organizationId,
      successUrl: `${appUrl}/brand/payment-method?card=saved`,
      cancelUrl: `${appUrl}/brand/payment-method?card=cancel`,
    });
  }

  async saveCard(organizationId: string, setupIntentId: string): Promise<void> {
    const card = await this.gateway.describeSavedCard(setupIntentId);
    await this.prisma.billingPaymentMethod.upsert({
      where: { organizationId },
      update: { brand: card.brand, last4: card.last4 },
      create: { organizationId, brand: card.brand, last4: card.last4 },
    });
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
