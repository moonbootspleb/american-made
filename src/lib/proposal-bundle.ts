const modules = import.meta.glob('../data/supply-proposals/*.json', {
  eager: true,
  import: 'default',
});

/** Proposals bundled with the server build, for a host that does not have the checkout. */
export function bundledProposals(): unknown[] {
  return Object.values(modules);
}
