import { DONATION_CENTS } from '../../src/lib/donation-cents.mjs';

const allowed = new Set<number>(DONATION_CENTS);

/**
 * Stripe secret keys only. Placeholders are treated as unset.
 * This file is not imported by the Astro pages, so the key is not inlined
 * into the static site.
 */
function stripeSecret(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(value)) return undefined;
  if (value.length < 20) return undefined;
  if (/placeholder|changeme|your_key|xxxx|example/i.test(value)) return undefined;
  return value;
}

function siteOrigin(): string {
  const prime = process.env.DEPLOY_PRIME_URL?.replace(/\/$/, '');
  const url = process.env.URL?.replace(/\/$/, '');
  return prime || url || 'http://localhost:8888';
}

/** Stripe must see the literal `{CHECKOUT_SESSION_ID}`, not a percent-encoded brace. */
export function checkoutFormBody(origin: string, cents: number): string {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('submit_type', 'donate');
  body.set('success_url', `${origin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${origin}/donate`);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(cents));
  body.set('line_items[0][price_data][product_data][name]', 'Donation to The American Forge');
  body.set('metadata[site]', 'the-american-forge');
  return body.toString().replaceAll('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
}

export default async function donate(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const origin = siteOrigin();
  const unavailable = `${origin}/donate/card-unavailable`;
  const secret = stripeSecret(process.env.STRIPE_SECRET_KEY);
  if (!secret) {
    return Response.redirect(unavailable, 303);
  }

  const params = new URLSearchParams(await req.text());
  const cents = Number(params.get('amount'));
  if (!Number.isInteger(cents) || !allowed.has(cents)) {
    return Response.redirect(unavailable, 303);
  }

  let stripeRes: Response;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: checkoutFormBody(origin, cents),
    });
  } catch {
    return Response.redirect(unavailable, 303);
  }

  if (!stripeRes.ok) {
    return Response.redirect(unavailable, 303);
  }

  let session: { url?: unknown };
  try {
    session = (await stripeRes.json()) as { url?: unknown };
  } catch {
    return Response.redirect(unavailable, 303);
  }

  if (typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
    return Response.redirect(unavailable, 303);
  }

  return Response.redirect(session.url, 303);
}
