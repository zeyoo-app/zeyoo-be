import { RiskLevel } from '@prisma/client';

export interface EngagementMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Deterministic authenticity heuristic (launch-phase rules engine). More
 * interactions than views is physically impossible and signals fake engagement;
 * interactions with zero views is suspicious.
 */
export function assessEngagement(metrics: EngagementMetrics): RiskLevel {
  const interactions = metrics.likes + metrics.comments + metrics.shares;
  if (metrics.views > 0 && interactions > metrics.views) {
    return 'HIGH';
  }
  if (metrics.views === 0 && interactions > 0) {
    return 'MEDIUM';
  }
  return 'LOW';
}
