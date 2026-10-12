import { Injectable, Logger } from '@nestjs/common';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const PUSH_BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const UNREGISTERED_ERROR = 'DeviceNotRegistered';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Outbound port for delivering a push notification to a set of device tokens. */
export abstract class PushSender {
  /** Resolves with the tokens the provider says are no longer valid, so they can be dropped. */
  abstract send(tokens: string[], message: PushMessage): Promise<string[]>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

/** Delivers through Expo's push service, which fans out to APNs and FCM. */
@Injectable()
export class ExpoPushSender extends PushSender {
  private readonly logger = new Logger(ExpoPushSender.name);

  async send(tokens: string[], message: PushMessage): Promise<string[]> {
    const invalid: string[] = [];
    for (let start = 0; start < tokens.length; start += PUSH_BATCH_SIZE) {
      const batch = tokens.slice(start, start + PUSH_BATCH_SIZE);
      const tickets = await this.sendBatch(batch, message);
      tickets.forEach((ticket, index) => {
        if (ticket.status === 'error' && ticket.details?.error === UNREGISTERED_ERROR) {
          invalid.push(batch[index]);
        }
      });
    }
    return invalid;
  }

  private async sendBatch(tokens: string[], message: PushMessage): Promise<ExpoTicket[]> {
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, sound: 'default', ...message }))),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Expo push responded with ${response.status}.`);
        return [];
      }
      const body = (await response.json()) as { data?: ExpoTicket[] };
      return body.data ?? [];
    } catch (error) {
      this.logger.warn(`Expo push request failed: ${String(error)}`);
      return [];
    }
  }
}
