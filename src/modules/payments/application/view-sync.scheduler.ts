import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { ViewTrackingService } from './view-tracking.service';

const MINUTES_TO_MS = 60_000;

/**
 * Periodically re-reads views for every live campaign so earnings follow the posts
 * without anyone pressing sync. Passes are idempotent, so several instances running
 * the same timer cannot double-credit. Disabled when the interval is 0 and in tests.
 */
@Injectable()
export class ViewSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ViewSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tracking: ViewTrackingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const intervalMinutes = this.config.get('VIEW_SYNC_INTERVAL_MINUTES', { infer: true });
    if (intervalMinutes === 0 || this.config.get('NODE_ENV', { infer: true }) === 'test') {
      return;
    }
    this.timer = setInterval(() => void this.runOnce(), intervalMinutes * MINUTES_TO_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  // Skips a tick if the previous pass is still going, so slow platforms cannot pile up.
  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.tracking.refreshAllLiveCampaigns();
    } catch (error) {
      this.logger.error(`View sync pass failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
