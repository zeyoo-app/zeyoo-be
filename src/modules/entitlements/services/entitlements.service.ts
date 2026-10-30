import { Injectable } from '@nestjs/common';
import { PrismaService } from '@platform/database/prisma.service';
import { DEFAULT_PLAN_KEY, planDefinition } from '../domain/plan-catalog';

export interface PlanEntitlements {
  planKey: string;
  maxActiveCampaigns: number | null;
  platformFeeBps: number;
  allowsPrivateCampaigns: boolean;
}

const BASIS_POINTS = 10_000;

/**
 * What an organization's plan allows. Depends only on the database, so campaigns and
 * payments can both ask without depending on billing (which depends on them).
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrganization(organizationId: string): Promise<PlanEntitlements> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      select: { planKey: true, status: true },
    });
    const planKey = subscription?.status === 'ACTIVE' ? subscription.planKey : DEFAULT_PLAN_KEY;
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (plan) {
      return {
        planKey: plan.key,
        maxActiveCampaigns: plan.maxActiveCampaigns,
        platformFeeBps: plan.platformFeeBps,
        allowsPrivateCampaigns: plan.allowsPrivateCampaigns,
      };
    }
    // The table is seeded from the catalog; fall back to it so limits never lapse.
    const definition = planDefinition(planKey) ?? planDefinition(DEFAULT_PLAN_KEY)!;
    return {
      planKey: definition.key,
      maxActiveCampaigns: definition.maxActiveCampaigns,
      platformFeeBps: definition.platformFeeBps,
      allowsPrivateCampaigns: definition.allowsPrivateCampaigns,
    };
  }

  /** The platform fee on a campaign budget, rounded to the nearest minor unit. */
  static feeMinor(budgetMinor: number, feeBps: number): number {
    return Math.round((budgetMinor * feeBps) / BASIS_POINTS);
  }
}
