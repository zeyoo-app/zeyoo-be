import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { DisputeService } from './dispute.service';

const HOUR_MS = 60 * 60 * 1_000;

/** Hourly: escalates disputes support has left unanswered past their response time. */
@Injectable()
export class DisputeEscalationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DisputeEscalationScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly disputes: DisputeService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') {
      return;
    }
    this.timer = setInterval(() => void this.runOnce(), HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(): Promise<void> {
    try {
      const escalated = await this.disputes.escalateOverdue();
      if (escalated > 0) {
        this.logger.log(`Escalated ${escalated} overdue dispute(s).`);
      }
    } catch (error) {
      this.logger.error(`Dispute escalation pass failed: ${String(error)}`);
    }
  }
}
