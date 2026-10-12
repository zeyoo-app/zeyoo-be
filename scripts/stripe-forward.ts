/**
 * Local stand-in for `stripe listen`: polls the Stripe test account for new events and
 * delivers each one, signed, to the local webhook endpoints.
 *
 * STRIPE_SECRET_KEY=sk_test_... FORWARD_SECRET=whsec_local \
 *   pnpm exec ts-node scripts/stripe-forward.ts http://localhost:3100/v1
 */
import Stripe from 'stripe';

const apiKey = process.env.STRIPE_SECRET_KEY ?? '';
const secret = process.env.FORWARD_SECRET ?? '';
const base = (process.argv[2] ?? 'http://localhost:3000/v1').replace(/\/$/, '');
const ENDPOINTS = ['/webhooks/stripe', '/webhooks/stripe/billing'];

if (!apiKey.startsWith('sk_test_') || !secret) {
  console.error('Needs a test-mode STRIPE_SECRET_KEY and FORWARD_SECRET.');
  process.exit(1);
}

const stripe = new Stripe(apiKey);
const seen = new Set<string>();
let since = Math.floor(Date.now() / 1000) - 1;

async function deliver(event: Stripe.Event): Promise<void> {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  for (const path of ENDPOINTS) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      body: payload,
    });
    console.log(`${event.type} -> ${path} ${response.status}`);
  }
}

async function poll(): Promise<void> {
  const page = await stripe.events.list({ created: { gte: since }, limit: 50 });
  for (const event of [...page.data].reverse()) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    since = Math.max(since, event.created);
    await deliver(event);
  }
}

console.log(`Forwarding Stripe test events to ${base}`);
setInterval(() => poll().catch((error) => console.error(String(error))), 2000);
