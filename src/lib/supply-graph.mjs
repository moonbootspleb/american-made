import { isPublishedManufacturer } from './publication.mjs';

/**
 * One graph for the map and the 3D view.
 * Coordinates are copied only from a sourced place that already has lat, lng,
 * and coordinateSources. City names are not geocoded.
 */

export const SUPPLY_COLORS = {
  domestic: '#24362e',
  foreign: '#7a4632',
  mixed: '#6a5428',
  unknown: '#5c5852',
};

export const FLAG_LABELS = {
  domestic: 'Domestic',
  foreign: 'Foreign',
  mixed: 'Mixed',
  unknown: 'Unknown',
};

const COUNTRY_NAMES = {
  AE: 'United Arab Emirates',
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CL: 'Chile',
  CN: 'China',
  CO: 'Colombia',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  EG: 'Egypt',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HK: 'Hong Kong',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IT: 'Italy',
  JP: 'Japan',
  KE: 'Kenya',
  KR: 'South Korea',
  MX: 'Mexico',
  MY: 'Malaysia',
  NG: 'Nigeria',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PE: 'Peru',
  PH: 'Philippines',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  RU: 'Russia',
  SA: 'Saudi Arabia',
  SE: 'Sweden',
  SG: 'Singapore',
  SK: 'Slovakia',
  TH: 'Thailand',
  TR: 'Turkey',
  TW: 'Taiwan',
  UA: 'Ukraine',
  US: 'United States',
  VN: 'Vietnam',
  ZA: 'South Africa',
};

const PRIMARY_KINDS = new Set(['manufacturing', 'mill', 'mine', 'farm', 'forest']);

/** Label for an ISO code already stored on a place. Unknown codes stay as the code. */
export function countryLabel(code) {
  if (!code || code === 'unknown') return 'Not on file';
  return COUNTRY_NAMES[code] ?? code;
}

export function flagLabel(flag) {
  return FLAG_LABELS[flag] ?? flag;
}

/**
 * A pin is allowed only when the place is sourced and a source is named for the coordinates.
 * @param {object | null | undefined} place
 * @returns {{ lat: number, lng: number } | null}
 */
export function sourcedCoordinate(place) {
  if (!place || typeof place !== 'object') return null;
  if (place.status !== 'sourced') return null;
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return null;
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  if (place.lat < -90 || place.lat > 90 || place.lng < -180 || place.lng > 180) return null;
  if (!Array.isArray(place.coordinateSources) || place.coordinateSources.length === 0) return null;
  if (place.coordinateSources.some((id) => typeof id !== 'string' || id.length === 0)) return null;
  return { lat: place.lat, lng: place.lng };
}

/** Plant, mill, or other working site when one is pinned. Otherwise the first pinned place. */
export function primaryLocation(node) {
  const locations = node?.locations ?? [];
  if (locations.length === 0) return null;
  return locations.find((location) => PRIMARY_KINDS.has(location.kind)) ?? locations[0];
}

export function manufacturerNodeId(slug) {
  return `manufacturer:${slug}`;
}

export function supplierNodeId(slug) {
  return `supplier:${slug}`;
}

/**
 * @param {{ nodes?: unknown[], edges?: unknown[] }} graph
 * @param {{ tier?: number | string, flag?: string, query?: string }} [options]
 */
export function filterSupplyGraph(graph, options = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const tierRaw = options.tier;
  const tier =
    tierRaw == null || tierRaw === '' || tierRaw === 'all' || Number.isNaN(Number(tierRaw))
      ? 'all'
      : Number(tierRaw);
  const flag = options.flag && options.flag !== 'all' ? options.flag : 'all';
  const query = String(options.query ?? '').trim().toLowerCase();

  let visibleEdges = edges.filter((edge) => {
    if (tier !== 'all' && edge.tier !== tier) return false;
    if (flag !== 'all' && edge.flag !== flag) return false;
    return true;
  });

  /** @type {Set<string>} */
  let ids = new Set();
  if (tier === 'all' && flag === 'all') {
    for (const node of nodes) ids.add(node.id);
  }
  for (const edge of visibleEdges) {
    ids.add(edge.source);
    ids.add(edge.target);
  }

  if (query) {
    const matched = new Set(
      nodes
        .filter(
          (node) =>
            String(node.name ?? '').toLowerCase().includes(query) ||
            String(node.slug ?? '').toLowerCase().includes(query),
        )
        .map((node) => node.id),
    );
    visibleEdges = visibleEdges.filter((edge) => matched.has(edge.source) || matched.has(edge.target));
    ids = new Set(matched);
    for (const edge of visibleEdges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  }

  return {
    nodes: nodes.filter((node) => ids.has(node.id)),
    edges: visibleEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

/**
 * @param {{ manufacturers?: unknown[], links?: unknown[] }} [input]
 */
export function buildSupplyGraph(input = {}) {
  const manufacturers = Array.isArray(input.manufacturers) ? input.manufacturers : [];
  const links = Array.isArray(input.links) ? input.links : [];
  const published = manufacturers.filter((profile) => isPublishedManufacturer(profile));
  const publishedSlugs = new Set(published.map((profile) => profile.slug));
  const keptLinks = linksReachableFromPublished(links, publishedSlugs);

  /** @type {Map<string, object>} */
  const nodes = new Map();
  for (const profile of published) {
    const id = manufacturerNodeId(profile.slug);
    const hqCountry = profile.hq && typeof profile.hq.country === 'string' ? profile.hq.country : 'unknown';
    nodes.set(id, {
      id,
      slug: profile.slug,
      name: profile.name,
      kind: 'manufacturer',
      identified: true,
      hqCountry,
      hqCountryLabel: countryLabel(hqCountry),
      placeLabel: manufacturerPlaceLabel(profile),
      tiers: [],
      tierLabel: 'On this list',
      locations: manufacturerLocations(profile),
      profileHref: `/manufacturers/${profile.slug}`,
      website: httpUrl(profile.website),
      parent: null,
      sources: [],
    });
  }

  for (const link of keptLinks) {
    const supplierId = supplierNodeId(link.supplier.slug);
    const existing = nodes.get(supplierId);
    const hqCountry = link.supplier.hq?.country ?? 'unknown';
    const locations = supplierLocations(link.supplier);
    if (!existing) {
      nodes.set(supplierId, {
        id: supplierId,
        slug: link.supplier.slug,
        name: link.supplier.name,
        kind: 'supplier',
        identified: link.supplier.identified === true,
        hqCountry,
        hqCountryLabel: countryLabel(hqCountry),
        placeLabel: formatPlace(link.supplier.hq),
        tiers: [],
        locations,
        profileHref: null,
        website: httpUrl(link.supplier.website),
        parent: parentRecord(link.supplier.parent),
        sources: [],
      });
    } else if (existing.kind === 'supplier') {
      if (link.supplier.identified === true) {
        existing.name = link.supplier.name;
        existing.identified = true;
      }
      if (!existing.website) existing.website = httpUrl(link.supplier.website);
      if (!existing.parent) existing.parent = parentRecord(link.supplier.parent);
      mergeLocations(existing, locations);
    }
  }

  const edges = keptLinks.map((link) => {
    const source = supplierNodeId(link.supplier.slug);
    const target =
      link.customer.type === 'manufacturer'
        ? manufacturerNodeId(link.customer.slug)
        : supplierNodeId(link.customer.slug);
    const supplier = nodes.get(source);
    const customer = nodes.get(target);
    const flag = link.flag;
    return {
      id: link.id,
      source,
      target,
      supplierName: supplier?.name ?? link.supplier.name,
      customerName: customer?.name ?? link.customer.name,
      inputName: link.input?.name ?? '',
      inputKey: link.input?.key ?? '',
      flag,
      flagLabel: flagLabel(flag),
      color: SUPPLY_COLORS[flag] ?? SUPPLY_COLORS.unknown,
      status: link.status,
      dashed: link.status !== 'verified',
      tier: link.tier,
      statusNote: link.statusNote ?? '',
      exitsUs: linkExitsUs(link),
      sources: uniqueSources(link.sources),
    };
  });

  for (const edge of edges) {
    const supplier = nodes.get(edge.source);
    if (supplier && !supplier.tiers.includes(edge.tier)) supplier.tiers.push(edge.tier);
    for (const id of [edge.source, edge.target]) {
      const node = nodes.get(id);
      if (!node) continue;
      node.sources = uniqueSources([...(node.sources ?? []), ...edge.sources]);
    }
  }

  const nodeList = [...nodes.values()].map((node) => {
    node.tiers.sort((a, b) => a - b);
    node.tierLabel = node.kind === 'manufacturer' ? 'On this list' : tierLabel(node.tiers);
    node.located = node.locations.length > 0;
    node.colorKey = nodeColorKey(node.hqCountry);
    node.color = SUPPLY_COLORS[node.colorKey];
    const share = shareByInputLine(keptLinks, node.kind === 'manufacturer' ? node.slug : customerSlugForSupplier(node, keptLinks));
    node.domesticShare = share.lines > 0 ? share : null;
    node.domesticShareLabel = shareLabel(share, node.kind);
    return node;
  });

  nodeList.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'manufacturer' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  edges.sort((a, b) => a.tier - b.tier || a.customerName.localeCompare(b.customerName) || a.supplierName.localeCompare(b.supplierName));

  return {
    nodes: nodeList,
    edges,
    colors: SUPPLY_COLORS,
  };
}

function customerSlugForSupplier(node, links) {
  if (node.kind !== 'supplier') return node.slug;
  const asCustomer = links.some((link) => link.customer.type === 'supplier' && link.customer.slug === node.slug);
  return asCustomer ? node.slug : null;
}

function linksReachableFromPublished(links, publishedSlugs) {
  const kept = [];
  const suppliers = new Set();
  const pending = links.filter((link) => link && link.customer && link.supplier);
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const link = pending[index];
      const ok =
        link.customer.type === 'manufacturer'
          ? publishedSlugs.has(link.customer.slug)
          : link.customer.type === 'supplier' && suppliers.has(link.customer.slug);
      if (!ok) continue;
      kept.push(link);
      suppliers.add(link.supplier.slug);
      pending.splice(index, 1);
      changed = true;
    }
  }
  return kept;
}

function manufacturerLocations(profile) {
  const locations = [];
  const hq = sourcedCoordinate(profile.hq);
  if (hq) {
    locations.push({
      id: 'hq',
      name: 'Headquarters',
      kind: 'headquarters',
      lat: hq.lat,
      lng: hq.lng,
      label: formatPlace(profile.hq),
    });
  }
  const facilities = Array.isArray(profile.facilities) ? profile.facilities : [];
  for (const facility of facilities) {
    const coord = sourcedCoordinate(facility?.place);
    if (!coord) continue;
    locations.push({
      id: facility.id,
      name: facility.name,
      kind: facility.kind,
      lat: coord.lat,
      lng: coord.lng,
      label: formatPlace(facility.place),
    });
  }
  return locations;
}

function supplierLocations(supplier) {
  const coord = sourcedCoordinate(supplier?.hq);
  if (!coord) return [];
  return [
    {
      id: 'hq',
      name: 'Headquarters',
      kind: 'headquarters',
      lat: coord.lat,
      lng: coord.lng,
      label: formatPlace(supplier.hq),
    },
  ];
}

function mergeLocations(node, locations) {
  for (const location of locations) {
    const exists = node.locations.some(
      (current) => current.lat === location.lat && current.lng === location.lng && current.kind === location.kind,
    );
    if (!exists) node.locations.push(location);
  }
}

function manufacturerPlaceLabel(profile) {
  if (profile.hq) {
    const label = formatPlace(profile.hq);
    if (label) return label;
  }
  const location = profile.location;
  if (!location) return '';
  return [location.city, location.region, location.country].filter(Boolean).join(', ');
}

function formatPlace(place) {
  if (!place || typeof place !== 'object') return '';
  const country = place.country && place.country !== 'unknown' ? countryLabel(place.country) : '';
  return [place.city, place.region, country].filter((part) => typeof part === 'string' && part.trim()).join(', ');
}

function parentRecord(parent) {
  if (!parent || typeof parent !== 'object' || !parent.name) return null;
  const country = parent.hq?.country ?? 'unknown';
  return {
    name: parent.name,
    country,
    countryLabel: countryLabel(country),
  };
}

function httpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function uniqueSources(sources) {
  const seen = new Set();
  const list = [];
  for (const source of sources ?? []) {
    if (!source || typeof source.url !== 'string' || typeof source.title !== 'string') continue;
    const url = httpUrl(source.url);
    if (!url) continue;
    const key = `${source.id ?? ''}\0${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: source.id ?? url,
      title: source.title,
      publisher: typeof source.publisher === 'string' ? source.publisher : '',
      url,
    });
  }
  return list;
}

function nodeColorKey(country) {
  if (country === 'US') return 'domestic';
  if (country && country !== 'unknown') return 'foreign';
  return 'unknown';
}

function tierLabel(tiers) {
  if (tiers.length === 0) return 'Not on file';
  if (tiers.length === 1) return `Tier ${tiers[0]}`;
  return `Tiers ${tiers.join(', ')}`;
}

/**
 * Same count as domesticShareByLine in supply-links.mjs.
 * A customer with no links gets lines: 0.
 */
function shareByInputLine(links, customerSlug) {
  const lines = new Map();
  if (customerSlug) {
    for (const link of links) {
      if (link.customer?.slug !== customerSlug) continue;
      const flags = lines.get(link.input.key) ?? [];
      flags.push(link.flag);
      lines.set(link.input.key, flags);
    }
  }
  let domestic = 0;
  let unknown = 0;
  for (const flags of lines.values()) {
    if (flags.every((flag) => flag === 'domestic')) domestic += 1;
    else if (flags.some((flag) => flag === 'unknown')) unknown += 1;
  }
  return { lines: lines.size, domestic, unknown, method: 'input lines' };
}

function shareLabel(share, kind) {
  if (!share || share.lines === 0) {
    return kind === 'supplier'
      ? 'No input lines on file. This record is a supplier.'
      : 'No input lines on file.';
  }
  const unknown = share.unknown === 1 ? '1 unknown' : `${share.unknown} unknown`;
  return `${share.domestic} of ${share.lines} input lines domestic (${unknown}). Counted by input line, not by dollars.`;
}

/** Same reasons as exitsUs in supply-links.mjs. */
function linkExitsUs(link) {
  const reasons = [];
  if (link.flag === 'foreign' || link.flag === 'mixed') reasons.push('input made or extracted outside the US');
  if (link.supplier.hq?.country !== 'US' && link.supplier.hq?.country !== 'unknown') {
    reasons.push('supplier headquartered outside the US');
  }
  const parentCountry = link.supplier.parent?.hq?.country;
  if (parentCountry && parentCountry !== 'US' && parentCountry !== 'unknown') {
    reasons.push('supplier parent headquartered outside the US');
  }
  return reasons;
}
