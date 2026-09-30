/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_STRIPE_PAYMENT_LINK?: string;
  readonly PUBLIC_STRIPE_CHECKOUT?: string;
  readonly PUBLIC_BITCOIN_DONATION_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
