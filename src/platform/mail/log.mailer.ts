import { Injectable, Logger } from '@nestjs/common';
import { Mailer } from './mailer';

/**
 * Development mailer: writes the message (including the code) to the app log
 * instead of sending it. This keeps the full auth flow exercisable locally with
 * no SMTP credentials. Production deployments bind a real provider adapter in
 * its place; a code must never reach the log outside development.
 */
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    this.logger.log(`[email-verification] to=${to} code=${code}`);
  }

  async sendPasswordResetCode(to: string, code: string): Promise<void> {
    this.logger.log(`[password-reset] to=${to} code=${code}`);
  }
}
