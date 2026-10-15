import L from 'leaflet';
import { primaryLocation } from '../lib/supply-graph.mjs';
import { markSelected, readSupplyGraph, renderSupplyDetail } from './supply-detail.js';

/** OpenStreetMap tiles. Pins come only from sourced coordinates on the graph. */
export function initSupplyMap() {
  const graph = readSupplyGraph();
  const stage = document.getElementById('supply-map');
  const detail = document.getElementById('supply-detail');
  if (!stage || !detail) return;

  const map = L.map(stage, {
    scrollWheelZoom: true,
    minZoom: 2,
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markers = new Map();
  const pinned = [];

  for (const node of graph.nodes ?? []) {
    for (const location of node.locations ?? []) {
      const marker = L.circleMarker([location.lat, location.lng], {
        radius: node.kind === 'manufacturer' ? 8 : 6,
        color: '#f3efe8',
        weight: 2,
        fillColor: node.color,
        fillOpacity: 0.95,
      });
      marker.bindTooltip(`${node.name} — ${location.label || location.name}`, { sticky: true });
      marker.on('click', () => select(node.id));
      marker.addTo(map);
      const group = markers.get(node.id) ?? [];
      group.push(marker);
      markers.set(node.id, group);
      pinned.push([location.lat, location.lng]);
    }
  }

  for (const edge of graph.edges ?? []) {
    const from = primaryLocation(graph.nodes.find((node) => node.id === edge.source));
    const to = primaryLocation(graph.nodes.find((node) => node.id === edge.target));
    if (!from || !to) continue;
    const latlngs = [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ];
    L.polyline(latlngs, {
      color: '#f3efe8',
      weight: 6,
      opacity: 0.9,
      interactive: false,
    }).addTo(map);
    L.polyline(latlngs, {
      color: edge.color,
      weight: 2.5,
      opacity: 0.95,
      dashArray: edge.dashed ? '7 6' : null,
    })
      .bindTooltip(`${edge.supplierName} → ${edge.customerName}`, { sticky: true })
      .addTo(map);
  }

  if (pinned.length > 0) {
    map.fitBounds(pinned, {
      paddingTopLeft: [28, 150],
      paddingBottomRight: [400, 56],
      maxZoom: 6,
    });
  } else {
    map.setView([39.8, -98.6], 4);
  }

  function paintMarkers(selectedId) {
    for (const [id, group] of markers) {
      for (const marker of group) {
        const node = graph.nodes.find((item) => item.id === id);
        marker.setStyle({
          radius: id === selectedId ? 11 : node?.kind === 'manufacturer' ? 8 : 6,
          weight: id === selectedId ? 3 : 2,
        });
      }
    }
  }

  function select(id) {
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) return;
    renderSupplyDetail(detail, node, graph);
    markSelected(id);
    paintMarkers(id);
    const place = primaryLocation(node);
    if (place) map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 6), { duration: 0.6 });
  }

  for (const button of document.querySelectorAll('[data-select-node]')) {
    button.addEventListener('click', () => select(button.getAttribute('data-select-node')));
  }

  const company = new URLSearchParams(window.location.search).get('company');
  if (company) {
    const node = graph.nodes.find((item) => item.slug === company || item.id === company);
    if (node) select(node.id);
  }

  const resize = () => map.invalidateSize();
  requestAnimationFrame(resize);
  window.addEventListener('resize', resize);
}
