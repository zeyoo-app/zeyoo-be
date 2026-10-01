import { Injectable, Logger } from '@nestjs/common';
import { SmsSender } from './sms.sender';

/**
 * Development SMS sender: writes the message (including the code) to the app log
 * instead of sending it. This keeps the full phone auth flow exercisable locally
 * with no provider credentials. A code must never reach the log outside
 * development.
 */
@Injectable()
export class LogSmsSender extends SmsSender {
  private readonly logger = new Logger('SmsSender');

  async sendVerificationCode(to: string, code: string): Promise<void> {
    this.logger.log(`[phone-verification] to=${to} code=${code}`);
  }
}
