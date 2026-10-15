import { primaryLocation } from '../lib/supply-graph.mjs';

/** Fill the side panel from a graph node. Text only, no invented fields. */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function row(dl, label, value) {
  const wrap = el('div');
  wrap.append(el('dt', null, label), el('dd', null, value || 'Not on file'));
  dl.append(wrap);
}

function safeHref(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function readSupplyGraph() {
  const node = document.getElementById('supply-graph-data');
  if (!node?.textContent) return { nodes: [], edges: [], colors: {} };
  return JSON.parse(node.textContent);
}

export function renderSupplyDetail(container, node, graph) {
  container.replaceChildren();
  if (!node) {
    container.append(el('p', null, 'Select a company.'));
    return;
  }

  container.append(el('h2', null, node.name));
  if (node.identified === false) {
    container.append(el('p', null, 'The sources name a place, not a company.'));
  }
  if (!node.located) {
    container.append(el('p', 'supply-unverified', 'Location unverified'));
  }

  const facts = el('dl', 'supply-facts');
  row(facts, 'Headquarters', node.hqCountryLabel);
  row(facts, 'Place on file', node.placeLabel);
  const pinned = primaryLocation(node);
  if (pinned?.address) row(facts, 'Street address', pinned.address);
  row(facts, 'Tier', node.tierLabel);
  row(facts, 'Domestic share', node.domesticShareLabel);
  if (node.parent?.name) {
    row(facts, 'Parent on file', `${node.parent.name}, ${node.parent.countryLabel}`);
  }
  container.append(facts);

  const links = document.createElement('p');
  links.className = 'supply-actions';
  if (node.profileHref) {
    const profile = el('a', null, 'Company page');
    profile.href = node.profileHref;
    links.append(profile);
  }
  const site = safeHref(node.website);
  if (site) {
    const anchor = el('a', null, 'Company site');
    anchor.href = site;
    anchor.rel = 'noopener noreferrer';
    links.append(anchor);
  }
  if (links.childNodes.length) container.append(links);

  const related = (graph.edges ?? []).filter((edge) => edge.source === node.id || edge.target === node.id);
  container.append(el('h3', null, related.length === 1 ? 'Link' : 'Links'));
  if (related.length === 0) {
    container.append(el('p', null, 'No supply links on file.'));
    return;
  }

  const list = el('ul', 'supply-detail-links');
  for (const edge of related) {
    const item = el('li');
    const direction = edge.source === node.id ? `Supplies ${edge.customerName}` : `Supplied by ${edge.supplierName}`;
    item.append(el('p', null, direction));
    item.append(
      el(
        'p',
        null,
        `${edge.inputName}. ${edge.flagLabel}. ${edge.dashed ? 'Unverified' : 'Verified'}.`,
      ),
    );
    if (edge.statusNote) item.append(el('p', 'quiet', edge.statusNote));
    if (edge.exitsUs?.length) {
      item.append(el('p', null, `Leaves the United States: ${edge.exitsUs.join('; ')}.`));
    }
    if (edge.sources?.length) {
      const sources = el('ul', 'supply-sources');
      for (const source of edge.sources) {
        const href = safeHref(source.url);
        const line = el('li');
        if (href) {
          const anchor = el('a', null, source.title);
          anchor.href = href;
          anchor.rel = 'noopener noreferrer';
          line.append(anchor);
        } else {
          line.append(el('span', null, source.title));
        }
        if (source.publisher) line.append(el('span', 'quiet', ` · ${source.publisher}`));
        sources.append(line);
      }
      item.append(sources);
    }
    list.append(item);
  }
  container.append(list);
  const panel = container.closest('.supply-panel');
  if (panel) panel.scrollTop = 0;
}

export function markSelected(id) {
  for (const button of document.querySelectorAll('[data-select-node]')) {
    const on = button.getAttribute('data-select-node') === id;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
