import { Global, Module } from '@nestjs/common';
import { LogMailer } from './log.mailer';
import { Mailer } from './mailer';

/**
 * Binds the {@link Mailer} port. Swap the `useClass` for a provider adapter
 * (e.g. SES/Resend) in production; callers inject the abstract `Mailer`.
 */
@Global()
@Module({
  providers: [{ provide: Mailer, useClass: LogMailer }],
  exports: [Mailer],
})
export class MailModule {}
