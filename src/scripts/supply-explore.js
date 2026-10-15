import { filterSupplyGraph } from '../lib/supply-graph.mjs';
import { markSelected, readSupplyGraph, renderSupplyDetail } from './supply-detail.js';

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function flyTo(chart, node, duration) {
  if (!node || !Number.isFinite(node.x)) return;
  const x = node.x || 0;
  const y = node.y || 0;
  const z = node.z || 0;
  const length = Math.hypot(x, y, z) || 1;
  const distance = 70;
  chart.cameraPosition(
    {
      x: x + (x / length) * distance,
      y: y + (y / length) * distance,
      z: z + (z / length) * distance,
    },
    node,
    duration,
  );
}

export async function initSupplyExplore() {
  const graph = readSupplyGraph();
  const detail = document.getElementById('supply-detail');
  const stage = document.getElementById('supply-stage');
  const note = document.getElementById('supply-webgl-note');
  const empty = document.getElementById('supply-filter-empty');
  const search = document.getElementById('supply-search');
  const tier = document.getElementById('supply-tier');
  const flag = document.getElementById('supply-flag');
  if (!detail || !stage || !search || !tier || !flag) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let chart = null;
  let pendingFocus = null;
  let fitted = false;

  function view() {
    return filterSupplyGraph(graph, {
      query: search.value,
      tier: tier.value,
      flag: flag.value,
    });
  }

  function paintList(next) {
    const nodeIds = new Set(next.nodes.map((node) => node.id));
    const edgeIds = new Set(next.edges.map((edge) => edge.id));
    for (const item of document.querySelectorAll('[data-supply-node]')) {
      item.hidden = !nodeIds.has(item.getAttribute('data-supply-node'));
    }
    for (const item of document.querySelectorAll('[data-supply-edge]')) {
      item.hidden = !edgeIds.has(item.getAttribute('data-supply-edge'));
    }
    if (empty) empty.hidden = next.nodes.length > 0;
  }

  function select(id) {
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) return;
    renderSupplyDetail(detail, node, graph);
    markSelected(id);
    if (!chart) return;
    const live = chart.graphData().nodes.find((item) => item.id === id);
    if (live && Number.isFinite(live.x)) flyTo(chart, live, reduceMotion ? 0 : 700);
    else pendingFocus = id;
  }

  function apply() {
    const next = view();
    paintList(next);
    if (!chart) return;
    fitted = false;
    chart.graphData({
      nodes: next.nodes.map((node) => ({ ...node })),
      links: next.edges.map((edge) => ({ ...edge })),
    });
  }

  for (const button of document.querySelectorAll('[data-select-node]')) {
    button.addEventListener('click', () => select(button.getAttribute('data-select-node')));
  }
  search.addEventListener('input', apply);
  tier.addEventListener('change', apply);
  flag.addEventListener('change', apply);

  const company = new URLSearchParams(window.location.search).get('company');
  if (company) search.value = company;

  const webgl = hasWebGL();
  if (!webgl) {
    stage.hidden = true;
    if (note) note.hidden = false;
    apply();
    if (company) {
      const node = graph.nodes.find((item) => item.slug === company || item.id === company);
      if (node) select(node.id);
    }
    return;
  }

  try {
    const { default: ForceGraph3D } = await import('3d-force-graph');
    const { LineDashedMaterial, BufferAttribute } = await import('three');
    const dashedMaterials = new Map();
    const dashedMaterial = (color) => {
      let material = dashedMaterials.get(color);
      if (!material) {
        material = new LineDashedMaterial({
          color,
          dashSize: 2.5,
          gapSize: 1.6,
        });
        dashedMaterials.set(color, material);
      }
      return material;
    };
    chart = ForceGraph3D()(stage)
      .showNavInfo(false)
      .backgroundColor('#d8d4cc')
      .nodeId('id')
      .nodeVal((node) => (node.kind === 'manufacturer' ? 2 : 0.7))
      .nodeRelSize(4)
      .nodeColor((node) => node.color)
      .nodeOpacity(1)
      .nodeLabel((node) => node.name)
      .linkSource('source')
      .linkTarget('target')
      .linkWidth(0)
      .linkColor((link) => link.color)
      .linkOpacity(1)
      .linkDirectionalArrowLength(8)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link) => link.color)
      .linkLabel((link) => `${link.supplierName} → ${link.customerName}`)
      .linkMaterial((link) => (link.dashed ? dashedMaterial(link.color) : null))
      .linkPositionUpdate((line, { start, end }, link) => {
        if (!link.dashed || line.type !== 'Line') return false;
        let attr = line.geometry.getAttribute('position');
        if (!attr || attr.count < 2) {
          attr = new BufferAttribute(new Float32Array(6), 3);
          line.geometry.setAttribute('position', attr);
        }
        attr.setXYZ(0, start.x, start.y || 0, start.z || 0);
        attr.setXYZ(1, end.x, end.y || 0, end.z || 0);
        attr.needsUpdate = true;
        line.geometry.computeBoundingSphere();
        line.computeLineDistances();
        return true;
      })
      .onNodeClick((node) => select(node.id))
      .onEngineStop(() => {
        if (pendingFocus) {
          const id = pendingFocus;
          pendingFocus = null;
          fitted = true;
          const live = chart.graphData().nodes.find((item) => item.id === id);
          if (live) flyTo(chart, live, reduceMotion ? 0 : 700);
          return;
        }
        if (!fitted) {
          fitted = true;
          chart.zoomToFit(reduceMotion ? 0 : 500, 50);
        }
      });

    const resize = () => {
      chart.width(stage.clientWidth);
      chart.height(stage.clientHeight);
    };
    resize();
    window.addEventListener('resize', resize);
    apply();
    if (company) {
      const node = graph.nodes.find((item) => item.slug === company || item.id === company);
      if (node) select(node.id);
    }
  } catch (error) {
    console.error(error);
    stage.hidden = true;
    if (note) note.hidden = false;
    apply();
  }
}
