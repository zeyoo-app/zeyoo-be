import createClient from 'openapi-fetch';

import type { paths } from './schema.js';

export type { components, operations, paths } from './schema.js';

export interface ZeyooClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
}

export function createZeyooClient({ baseUrl, getAccessToken }: ZeyooClientOptions) {
  const client = createClient<paths>({ baseUrl });

  if (getAccessToken) {
    client.use({
      async onRequest({ request }) {
        const token = await getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    });
  }

  return client;
}

export type ZeyooClient = ReturnType<typeof createZeyooClient>;
