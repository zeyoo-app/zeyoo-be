// Public surface of the fraud module. Other modules import ONLY from here.
export { FraudModule } from './fraud.module';
export { FraudService } from './services/fraud.service';
export type { FraudCaseView } from './services/fraud.service';
export { assessEngagement } from './domain/risk-rules';
