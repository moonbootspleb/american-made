/**
 * Admin queue: listen for the live source viewer and show whether it found the quote.
 * The viewer runs in a sandboxed frame (origin "null"), so the message is trusted only
 * when it comes from that card's own frame.
 */
const TIMEOUT_MS = 30000;

function setStatus(card, state, text) {
  const status = card.querySelector('[data-quote-status]');
  if (status) {
    status.setAttribute('data-quote-status', state);
    status.textContent = text;
  }
  const hidden = card.querySelector('[data-viewer-found]');
  if (hidden) hidden.value = state === 'found' ? 'true' : state === 'not-found' ? 'false' : '';
}

const cards = Array.from(document.querySelectorAll('[data-supply-proposal]'));

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== 'taf-source-view') return;
  const card = cards.find((item) => {
    const frame = item.querySelector('[data-source-frame]');
    return frame && frame.contentWindow === event.source;
  });
  if (!card || card.getAttribute('data-supply-proposal') !== data.proposal) return;
  card.setAttribute('data-viewer-reported', 'true');
  if (data.failed) {
    setStatus(card, 'failed', `The live page did not load: ${String(data.message || 'no detail')}`);
  } else if (data.found) {
    setStatus(card, 'found', data.method === 'normalized' || data.method === 'trimmed'
      ? 'Found on the live page (quote marks and spacing folded). Highlighted on the left.'
      : 'Found on the live page. Highlighted on the left.');
  } else {
    setStatus(card, 'not-found', 'Quote not found on live page.');
  }
});

for (const card of cards) {
  const frame = card.querySelector('[data-source-frame]');
  if (!frame) continue;
  frame.addEventListener('load', () => {
    window.setTimeout(() => {
      if (card.getAttribute('data-viewer-reported') !== 'true') {
        setStatus(card, 'failed', 'The live page loaded but did not report a match. Check it by hand.');
      }
    }, 4000);
  });
  window.setTimeout(() => {
    if (card.getAttribute('data-viewer-reported') !== 'true') {
      const status = card.querySelector('[data-quote-status]');
      if (status && status.getAttribute('data-quote-status') === 'pending') {
        setStatus(card, 'failed', 'The live page did not answer in time. Use the link to open it.');
      }
    }
  }, TIMEOUT_MS);
}
