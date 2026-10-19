import { normalizeWithMap } from './quote-match.mjs';

/**
 * What a reviewer needs next to the live source: the claim in one sentence,
 * and what the quote does not establish.
 * Automatic notes are written only when they follow from the proposal text itself.
 * Anything that needs reading the page goes in the proposal's `gaps` field, written by research.
 */

/**
 * @param {{ claim?: string, supplier: { name: string, city?: string, region?: string }, customer: { name: string }, input: { name: string } }} proposal
 */
export function claimSentence(proposal) {
  if (proposal.claim && proposal.claim.trim()) return proposal.claim.trim();
  const place = [proposal.supplier.city, proposal.supplier.region].filter(Boolean).join(', ');
  const who = place ? `${proposal.supplier.name} (${place})` : proposal.supplier.name;
  return `${who} supplies ${proposal.input.name} to ${proposal.customer.name}.`;
}

/**
 * @param {string} value
 */
function norm(value) {
  return normalizeWithMap(value).text;
}

const HEDGES = /\b(could|might|may|possibly|perhaps)\b/;

/**
 * @param {{ id: string, quote: string, supplier: { name: string }, customer: { name: string }, input: { name: string }, sourceCheck?: { published?: string } }} proposal
 * @param {Array<{ id: string, quote: string, sourceUrl?: string, supplier: { name: string } }>} [all] every proposal on file
 * @param {Date} [now]
 * @returns {string[]}
 */
export function autoGaps(proposal, all = [], now = new Date()) {
  const quote = norm(proposal.quote);
  /** @type {string[]} */
  const gaps = [];

  const customer = norm(proposal.customer.name);
  const customerHead = customer.split(' ')[0];
  if (!quote.includes(customer) && !(customerHead.length >= 4 && quote.includes(customerHead))) {
    gaps.push(`The quote does not name ${proposal.customer.name}. The tie to the customer rests on the rest of the page.`);
  }

  const others = all
    .filter((item) => item.id !== proposal.id && norm(item.quote) === quote)
    .map((item) => item.supplier.name)
    .filter((name) => name !== proposal.supplier.name);
  if (others.length > 0) {
    const names = [proposal.supplier.name, ...new Set(others)];
    gaps.push(
      `The same quote names ${names.join(' and ')}. It does not say which of them supplies ${proposal.input.name}.`,
    );
  }

  const hedge = quote.match(HEDGES);
  if (hedge) {
    gaps.push(`The quote is hedged ("${hedge[1]}"). It lists possible sources, not a confirmed supplier.`);
  }

  let withoutNames = quote;
  for (const name of [proposal.supplier.name, ...others]) withoutNames = withoutNames.split(norm(name)).join(' ');
  const inputWords = norm(proposal.input.name)
    .split(' ')
    .map((word) => word.replace(/(ing|es|s)$/, ''))
    .filter((word) => word.length >= 4);
  if (inputWords.length > 0 && !inputWords.some((word) => withoutNames.includes(word))) {
    gaps.push(`The quote does not mention ${proposal.input.name}.`);
  }

  const published = proposal.sourceCheck?.published ? new Date(proposal.sourceCheck.published) : null;
  if (published && !Number.isNaN(published.getTime())) {
    const years = (now.getTime() - published.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years >= 3) {
      gaps.push(
        `The page was published ${published.toISOString().slice(0, 10)}, about ${Math.floor(years)} years ago. It does not show the supply relationship is current.`,
      );
    }
  }
  return gaps;
}

/**
 * Automatic notes first, then the ones research wrote. Duplicates dropped.
 * @param {Parameters<typeof autoGaps>[0] & { gaps?: string[] }} proposal
 * @param {Parameters<typeof autoGaps>[1]} [all]
 */
export function reviewGaps(proposal, all = []) {
  return [...new Set([...autoGaps(proposal, all), ...(proposal.gaps || [])])];
}
