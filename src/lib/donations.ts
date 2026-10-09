export { DONATION_CENTS } from './donation-cents.mjs';

export function donationLabel(cents: number): string {
  return `$${cents / 100}`;
}

/**
 * Documentation addresses that must never be shown as this site's wallet.
 * BIP 173 and widely copied sample addresses. Stored lowercase.
 */
const DOCUMENTED_BITCOIN = new Set([
  'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  '1boatslrhtknngkdxeeobr76b53lettpyt',
  '3j98t1wpez73cnmyviecrnyiwrnqrhwnly',
]);

/**
 * A mainnet address Boots has actually set.
 * Anything else, including placeholders and sample addresses, is not shown.
 */
export function bitcoinDonationAddress(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (/placeholder|changeme|example|your-?address|todo|xxxx|wallet-here|coming-soon/i.test(value)) {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (DOCUMENTED_BITCOIN.has(lower)) return undefined;
  if (/^bc1[ac-hj-np-z02-9]{25,87}$/.test(lower)) return lower;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) return value;
  return undefined;
}

/** A Stripe Payment Link or a Stripe donate link. Other hosts are ignored. */
export function stripePaymentLink(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || /placeholder|your-link|changeme|example|xxxx/i.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase();
  if (host !== 'buy.stripe.com' && host !== 'donate.stripe.com') return undefined;
  const id = url.pathname.replaceAll('/', '');
  if (id.length < 8) return undefined;
  return url.toString();
}

/** Public opt-in for the amount buttons. The secret key stays off the page. */
export function cardCheckoutEnabled(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}
