// Public surface of the entitlements module. Other modules import ONLY from here.
export { EntitlementsModule } from './entitlements.module';
export { EntitlementsService } from './services/entitlements.service';
export type { PlanEntitlements } from './services/entitlements.service';
export { PLAN_CATALOG, DEFAULT_PLAN_KEY, planDefinition } from './domain/plan-catalog';
export type { PlanDefinition, PlanKey } from './domain/plan-catalog';
