import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Subscription } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { AppPaths, returnUrl, type ReturnClient } from '@platform/links';
import { EntitlementsService } from '@modules/entitlements/entitlements.public';
import { MembershipService, OrganizationService } from '@modules/iam/iam.public';
import { WalletService } from '@modules/payments/payments.public';
import { BILLING_GATEWAY, BillingGatewayPort } from '../ports/billing-gateway.port';

export type BillingPlanLabel = 'Starter' | 'Growth' | 'Scale';

export interface BrandBillingView {
  plan: BillingPlanLabel;
  monthlySpend: { minorUnits: number; currency: string };
  totalFunded: { minorUnits: number; currency: string };
  paymentMethodLast4?: string;
  /** Set once the brand cancels: the paid plan runs until this date, then Starter applies. */
  planEndsAt?: string;
  /** Prepaid wallet balance brands can spend on campaigns (USD). */
  walletBalance: { minorUnits: number; currency: string };
  /** Fee added on top of each campaign budget at checkout, in basis points. */
  platformFeeBps: number;
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
    private readonly entitlements: EntitlementsService,
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
    client: ReturnClient = 'web',
  ): Promise<{ url: string | null; changed?: boolean }> {
    await this.memberships.assertOwner(organizationId, requesterId);
    const plan = await this.requirePurchasablePlan(planKey);

    // Already paying: switch the live subscription instead of starting a second one.
    // Stripe prorates the difference on the next invoice.
    const current = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (current?.status === 'ACTIVE' && current.stripeSubscriptionId) {
      if (current.planKey === planKey && !current.cancelAt) {
        throw new ConflictException('You are already on this plan.');
      }
      await this.gateway.changeSubscriptionPrice(current.stripeSubscriptionId, plan.stripePriceId as string);
      await this.prisma.subscription.update({
        where: { organizationId },
        data: { planKey, cancelAt: null },
      });
      return { url: null, changed: true };
    }

    const base = this.config.get('APP_WEB_URL', { infer: true });
    const page = AppPaths.brandSubscription;
    const checkout = await this.gateway.createSubscriptionCheckout({
      organizationId,
      planKey,
      priceId: plan.stripePriceId as string,
      successUrl: returnUrl(base, `${page}?checkout=success`, client),
      cancelUrl: returnUrl(base, `${page}?checkout=cancel`, client),
    });
    await this.prisma.subscription.upsert({
      where: { organizationId },
      update: { planKey, status: 'INCOMPLETE' },
      create: { organizationId, planKey, status: 'INCOMPLETE' },
    });
    return checkout;
  }

  /**
   * Moves the brand back to Starter at the end of the period they have paid for. The
   * paid plan keeps working until then; Stripe ends it and the webhook records it.
   */
  async cancel(organizationId: string, requesterId: string): Promise<{ planEndsAt: string }> {
    await this.memberships.assertOwner(organizationId, requesterId);
    const current = await this.requireActiveSubscription(organizationId);
    const endsAt = await this.gateway.cancelAtPeriodEnd(current.stripeSubscriptionId as string);
    await this.prisma.subscription.update({ where: { organizationId }, data: { cancelAt: endsAt } });
    return { planEndsAt: endsAt.toISOString() };
  }

  /** Keeps a plan the brand had cancelled, so it renews as before. */
  async resume(organizationId: string, requesterId: string): Promise<void> {
    await this.memberships.assertOwner(organizationId, requesterId);
    const current = await this.requireActiveSubscription(organizationId);
    if (!current.cancelAt) {
      throw new ConflictException('This plan is not set to end.');
    }
    await this.gateway.resume(current.stripeSubscriptionId as string);
    await this.prisma.subscription.update({ where: { organizationId }, data: { cancelAt: null } });
  }

  /** The brand billing summary shown on the subscription and wallet screens. */
  async getBilling(organizationId: string, requesterId: string): Promise<BrandBillingView> {
    await this.organizations.assertMember(organizationId, requesterId);
    const [subscription, paymentMethod, totals, entitlements] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId } }),
      this.prisma.billingPaymentMethod.findUnique({ where: { organizationId } }),
      this.wallet.organizationTotals(organizationId),
      this.entitlements.forOrganization(organizationId),
    ]);
    const active = subscription?.status === 'ACTIVE' ? subscription.planKey : null;
    return {
      plan: planLabel(active),
      planEndsAt: active && subscription?.cancelAt ? subscription.cancelAt.toISOString() : undefined,
      monthlySpend: totals.monthlySpend,
      totalFunded: totals.totalFunded,
      walletBalance: totals.walletBalance,
      paymentMethodLast4: paymentMethod?.last4,
      platformFeeBps: entitlements.platformFeeBps,
    };
  }

  /** Starts the hosted card-save flow; the client opens the returned URL. */
  async startCardSetup(
    organizationId: string,
    requesterId: string,
    client: ReturnClient = 'web',
  ): Promise<{ url: string }> {
    await this.memberships.assertOwner(organizationId, requesterId);
    const base = this.config.get('APP_WEB_URL', { infer: true });
    const page = AppPaths.brandPaymentMethod;
    return this.gateway.createCardSetupCheckout({
      organizationId,
      successUrl: returnUrl(base, `${page}?card=saved`, client),
      cancelUrl: returnUrl(base, `${page}?card=cancel`, client),
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
      data: { status: 'ACTIVE', stripeSubscriptionId, cancelAt: null },
    });
  }

  async cancelByStripeId(stripeSubscriptionId: string): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId },
      data: { status: 'CANCELED' },
    });
  }

  private async requireActiveSubscription(organizationId: string): Promise<Subscription> {
    const current = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (current?.status !== 'ACTIVE' || !current.stripeSubscriptionId) {
      throw new ConflictException('You are on the free Starter plan; there is nothing to cancel.');
    }
    return current;
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
