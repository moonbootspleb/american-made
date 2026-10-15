export const QUEUE_FORMS = [
  { id: 'review-request', label: 'Review requests' },
  { id: 'company-suggestion', label: 'Company suggestions' },
  { id: 'page-submission', label: 'Page submissions' },
];

const FORM_IDS = new Set(QUEUE_FORMS.map((form) => form.id));

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/**
 * @param {string} formName
 * @param {string} type
 */
export function submissionKind(formName, type) {
  if (formName === 'page-submission') {
    if (type === 'review') return 'Review';
    if (type === 'edit') return 'Proposed edit';
    return 'Page submission';
  }
  if (formName === 'review-request') return 'Review request';
  if (formName === 'company-suggestion') return 'Company suggestion';
  return formName;
}

/**
 * @param {string} href
 */
export function isXUrl(href) {
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'mobile.x.com';
  } catch {
    return false;
  }
}

/**
 * @param {string} value
 */
export function safeHttpUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

/**
 * A path on this site. Used as a link only when it cannot leave the site.
 * @param {string} value
 */
export function safePagePath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '';
  if (value.includes('\\') || value.includes('://') || /\s/.test(value)) return '';
  if (!/^\/[A-Za-z0-9/._~-]*$/.test(value)) return '';
  return value;
}

/**
 * @param {string} value
 */
export function safeEmail(value) {
  if (!value) return '';
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) return '';
  return value;
}

/**
 * @param {string} iso
 */
export function formatSubmittedAt(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(time));
  return `${formatted} UTC`;
}

/**
 * Split evidence into text and links. Trailing punctuation stays as text.
 * @param {string} text
 * @returns {Array<{ type: 'text', value: string } | { type: 'link', href: string, x: boolean }>}
 */
export function evidenceParts(text) {
  if (!text) return [];
  /** @type {Array<{ type: 'text', value: string } | { type: 'link', href: string, x: boolean }>} */
  const parts = [];
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    const raw = match[0];
    const href = raw.replace(/[),.;|]+$/g, '');
    const trail = raw.slice(href.length);
    const safe = safeHttpUrl(href);
    if (safe) {
      parts.push({ type: 'link', href: safe, x: isXUrl(safe) });
      if (trail) parts.push({ type: 'text', value: trail });
    } else {
      parts.push({ type: 'text', value: raw });
    }
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/**
 * @param {unknown} raw
 * @param {string} key
 */
function field(raw, key) {
  const data = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : {};
  const fromData = data[key];
  if (typeof fromData === 'string' && fromData.trim()) return fromData.trim();
  if (key === 'body' || key === 'email' || key === 'name' || key === 'company') {
    const top = raw && typeof raw === 'object' ? raw[key] : undefined;
    if (typeof top === 'string' && top.trim()) return top.trim();
  }
  return '';
}

/**
 * Keep the fields a person reviews. Drop Netlify's ip, user agent, and honeypot.
 * @param {unknown} raw
 */
export function normalizeSubmission(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const formName = typeof raw.form_name === 'string' ? raw.form_name : '';
  if (!FORM_IDS.has(formName)) return null;

  const company = field(raw, 'company');
  const companyUrlText = field(raw, 'company_url');
  const page = field(raw, 'page');
  const type = field(raw, 'type');
  const email = field(raw, 'email');
  const evidence = field(raw, 'evidence');
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : '';
  const number = Number.isInteger(raw.number) ? raw.number : null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `${formName}-${createdAt}-${number ?? 'x'}`;

  return {
    id,
    number,
    formName,
    kind: submissionKind(formName, type),
    createdAt,
    submittedAt: formatSubmittedAt(createdAt),
    title: company || page || 'Untitled note',
    company,
    companyUrl: safeHttpUrl(companyUrlText),
    companyUrlText,
    page,
    pageHref: safePagePath(page),
    place: field(raw, 'place'),
    products: field(raw, 'products'),
    name: field(raw, 'name'),
    email,
    emailHref: safeEmail(email),
    body: field(raw, 'body'),
    evidence,
    evidenceParts: evidenceParts(evidence),
  };
}

/**
 * @param {unknown[]} rawList
 */
export function normalizeSubmissions(rawList) {
  const items = [];
  for (const raw of rawList) {
    const item = normalizeSubmission(raw);
    if (item) items.push(item);
  }
  return sortNewest(items);
}

/**
 * @param {Array<{ createdAt: string }>} items
 */
export function sortNewest(items) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    const aOk = Number.isFinite(aTime);
    const bOk = Number.isFinite(bTime);
    if (aOk && bOk && aTime !== bTime) return bTime - aTime;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    return 0;
  });
}

/**
 * @param {string | null | undefined} raw
 * @returns {'all' | 'review-request' | 'company-suggestion' | 'page-submission'}
 */
export function selectedForm(raw) {
  if (raw === 'review-request' || raw === 'company-suggestion' || raw === 'page-submission') return raw;
  return 'all';
}

/**
 * @param {Array<{ formName: string }>} items
 * @param {string} form
 */
export function filterByForm(items, form) {
  if (!FORM_IDS.has(form)) return items;
  return items.filter((item) => item.formName === form);
}

/**
 * @param {Array<{ formName: string }>} items
 */
export function countByForm(items) {
  const counts = {
    all: items.length,
    'review-request': 0,
    'company-suggestion': 0,
    'page-submission': 0,
  };
  for (const item of items) {
    if (item.formName in counts && item.formName !== 'all') counts[item.formName] += 1;
  }
  return counts;
}
