(() => {
  'use strict';

  const DATA_URLS = ['/data/f14-kgu-c029m-1.geojson','/data/f14-kgu-c029m-2.geojson','/data/f14-kgu-c029m-3.geojson','/data/f14-kgu-c029m-4.geojson'];
  const DEFAULT_FDC = 'FDC KGU C029M';
  const SNAP_METERS = 5;

  const state = {
    geojson: null,
    labels: [],
    dps: [],
    fdcs: [],
    joints: [],
    graph: new Map(),
    nodeCoords: new Map(),
    defaultFdc: null,
    selectedDp: null,
    activeRoute: null,
    routeLayer: null,
    mover: null,
    animationId: null,
    playing: false,
    speed: 'normal',
    progress: 0,
    baseLayers: {},
    activeBaseLayer: 'satellite',
    markerLayer: null,
    sourceRouteLayer: null,
    markersByName: new Map(),
    lastPan: 0
  };

  const $ = id => document.getElementById(id);
  const ui = {
    searchInput: $('searchInput'), searchResults: $('searchResults'), traceBtn: $('traceBtn'),
    selectedNode: $('selectedNode'), destination: $('destination'), totalDistance: $('totalDistance'),
    coveredDistance: $('coveredDistance'), balanceDistance: $('balanceDistance'), traceStatus: $('traceStatus'),
    playBtn: $('playBtn'), playText: $('playText'), playIcon: $('playIcon'), resetBtn: $('resetBtn'),
    speedControl: $('speedControl'), mapStatus: $('mapStatus'), detailsPanel: $('detailsPanel'),
    mobileDetailsBtn: $('mobileDetailsBtn'), networkBadge: $('networkBadge')
  };

  const map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true });
  state.baseLayers.map = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap contributors'
  });
  state.baseLayers.satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, attribution: 'Tiles &copy; Esri' }
  );
  state.baseLayers.satellite.addTo(map);
  state.sourceRouteLayer = L.layerGroup().addTo(map);
  state.markerLayer = L.layerGroup().addTo(map);

  const nodeIcon = type => L.divIcon({
    className: '',
    html: `<span class="node-marker ${type}"></span>`,
    iconSize: type === 'fdc' ? [24,24] : [18,18],
    iconAnchor: type === 'fdc' ? [12,12] : [9,9]
  });

  const moverIcon = L.divIcon({
    className: '', html: '<div class="trace-mover-wrap"><div class="trace-mover"></div></div>',
    iconSize: [30,30], iconAnchor: [15,15]
  });

  function mercatorToLngLat(x, y) {
    const lng = x / 20037508.34 * 180;
    let lat = y / 20037508.34 * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return [lng, lat];
  }

  function toLngLat(coord) {
    const [x, y] = coord;
    return Math.abs(x) > 180 || Math.abs(y) > 90 ? mercatorToLngLat(x, y) : [x, y];
  }

  const coordKey = p => `${Number(p[0]).toFixed(3)},${Number(p[1]).toFixed(3)}`;
  const xyDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function addEdge(a, b, weight) {
    const ak = coordKey(a), bk = coordKey(b);
    state.nodeCoords.set(ak, a); state.nodeCoords.set(bk, b);
    if (!state.graph.has(ak)) state.graph.set(ak, []);
    if (!state.graph.has(bk)) state.graph.set(bk, []);
    state.graph.get(ak).push({ to: bk, weight });
    state.graph.get(bk).push({ to: ak, weight });
  }

  function buildTopology(data) {
    state.graph.clear(); state.nodeCoords.clear();
    const endpoints = [];
    const lineFeatures = [];
    state.labels = [];

    data.features.forEach((f, idx) => {
      const g = f.geometry || {};
      const props = f.properties || {};
      if (g.type === 'LineString') {
        const pts = g.coordinates.map(c => [Number(c[0]), Number(c[1])]);
        lineFeatures.push({ idx, pts, props });
        for (let i = 0; i < pts.length - 1; i++) addEdge(pts[i], pts[i + 1], xyDistance(pts[i], pts[i + 1]));
        if (pts.length) endpoints.push(pts[0], pts[pts.length - 1]);
      } else if (g.type === 'Point') {
        const text = String(props?.__style?.text || props.name || '').trim();
        if (text) state.labels.push({ name: text, xy: [Number(g.coordinates[0]), Number(g.coordinates[1])], props });
      }
    });

    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const d = xyDistance(endpoints[i], endpoints[j]);
        if (d > 0 && d <= SNAP_METERS) addEdge(endpoints[i], endpoints[j], d);
      }
    }

    state.dps = state.labels.filter(x => /^DP\d/i.test(x.name));
    state.fdcs = state.labels.filter(x => /^FDC\b/i.test(x.name));
    state.joints = state.labels.filter(x => /^(JT|JOINT|CLOSURE)\b/i.test(x.name));
    state.defaultFdc = state.fdcs.find(x => x.name.toUpperCase() === DEFAULT_FDC.toUpperCase()) || state.fdcs[0] || null;

    drawSourceRoutes(lineFeatures);
    drawNodes();
  }

  function drawSourceRoutes(lines) {
    state.sourceRouteLayer.clearLayers();
    const allLatLngs = [];
    lines.forEach(({ pts, props }) => {
      const latlngs = pts.map(p => { const [lng, lat] = toLngLat(p); allLatLngs.push([lat, lng]); return [lat, lng]; });
      const src = props.__style || {};
      const color = src.strokeColor || '#4d6a87';
      L.polyline(latlngs, { color, weight: 2.2, opacity: .36, interactive: false }).addTo(state.sourceRouteLayer);
    });
    if (allLatLngs.length) map.fitBounds(L.latLngBounds(allLatLngs), { padding: [20, 20] });
  }

  function classify(label) {
    if (/^DP\d/i.test(label.name)) return 'dp';
    if (/^FDC\b/i.test(label.name)) return 'fdc';
    if (/^(JT|JOINT|CLOSURE)\b/i.test(label.name)) return 'jt';
    return null;
  }

  function drawNodes() {
    state.markerLayer.clearLayers(); state.markersByName.clear();
    state.labels.forEach(label => {
      const type = classify(label);
      if (!type) return;
      const [lng, lat] = toLngLat(label.xy);
      const marker = L.marker([lat, lng], { icon: nodeIcon(type), riseOnHover: true, keyboard: false }).addTo(state.markerLayer);
      marker.bindTooltip(label.name, { direction: 'top', offset: [0,-8], className: 'node-label', opacity: .95 });
      if (type === 'dp') marker.on('click', () => selectAndTrace(label.name, true));
      if (type === 'fdc') marker.on('click', () => {
        ui.destination.textContent = label.name;
        ui.mapStatus.textContent = `FDC: ${label.name}`;
      });
      state.markersByName.set(label.name.toUpperCase(), marker);
    });
  }

  function nearestGraphKey(xy, max = 80) {
    let best = null, bestD = Infinity;
    for (const [key, node] of state.nodeCoords.entries()) {
      const d = xyDistance(xy, node);
      if (d < bestD) { best = key; bestD = d; }
    }
    return bestD <= max ? { key: best, distance: bestD } : null;
  }

  function dijkstra(startKey, endKey) {
    const dist = new Map([[startKey, 0]]);
    const prev = new Map();
    const visited = new Set();
    const queue = [{ key: startKey, d: 0 }];
    while (queue.length) {
      queue.sort((a,b) => a.d - b.d);
      const cur = queue.shift();
      if (visited.has(cur.key)) continue;
      visited.add(cur.key);
      if (cur.key === endKey) break;
      for (const edge of state.graph.get(cur.key) || []) {
        if (visited.has(edge.to)) continue;
        const nd = cur.d + edge.weight;
        if (nd < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nd); prev.set(edge.to, cur.key); queue.push({ key: edge.to, d: nd });
        }
      }
    }
    if (!dist.has(endKey)) return null;
    const keys = [];
    let k = endKey;
    while (k) { keys.push(k); if (k === startKey) break; k = prev.get(k); }
    keys.reverse();
    return { keys, distance: dist.get(endKey) };
  }

  function findRoute(dp, fdc) {
    const s = nearestGraphKey(dp.xy), e = nearestGraphKey(fdc.xy);
    if (!s || !e) return null;
    const result = dijkstra(s.key, e.key);
    if (!result) return null;
    const coords = result.keys.map(k => state.nodeCoords.get(k));
    if (xyDistance(dp.xy, coords[0]) > .01) coords.unshift(dp.xy);
    if (xyDistance(fdc.xy, coords[coords.length - 1]) > .01) coords.push(fdc.xy);
    const distance = result.distance + s.distance + e.distance;
    const latlngs = coords.map(p => { const [lng, lat] = toLngLat(p); return L.latLng(lat, lng); });
    return { coords, latlngs, distance };
  }

  function selectAndTrace(name, openMobilePanel = false) {
    stopAnimation(false);
    const dp = state.dps.find(x => x.name.toUpperCase() === String(name).toUpperCase());
    if (!dp || !state.defaultFdc) return showError('DP or FDC not found.');
    const route = findRoute(dp, state.defaultFdc);
    if (!route) return showError(`No connected route found for ${dp.name}.`);

    state.selectedDp = dp; state.activeRoute = route; state.progress = 0;
    if (state.routeLayer) state.routeLayer.remove();
    state.routeLayer = L.polyline(route.latlngs, { color:'#ffd800', weight:7, opacity:.98, lineCap:'round', lineJoin:'round' }).addTo(map);
    state.routeLayer.bringToFront();

    const marker = state.markersByName.get(dp.name.toUpperCase());
    if (marker) {
      marker.unbindTooltip();
      marker.bindTooltip(dp.name, { permanent:true, direction:'right', offset:[10,0], className:'node-label dp-selected', opacity:1 }).openTooltip();
    }

    map.fitBounds(state.routeLayer.getBounds(), { padding:[42,42], maxZoom:18, animate:true });
    updateTraceUI(0);
    ui.traceStatus.textContent = 'Ready'; ui.traceStatus.classList.add('active');
    ui.mapStatus.textContent = `${dp.name} → ${state.defaultFdc.name} • ${(route.distance/1000).toFixed(3)} km`;
    ui.playBtn.disabled = false; ui.resetBtn.disabled = false;
    ui.searchInput.value = dp.name;
    if (openMobilePanel && window.innerWidth <= 760) ui.detailsPanel.classList.add('open');
  }

  function showError(msg) {
    ui.mapStatus.textContent = msg; ui.traceStatus.textContent = 'No route'; ui.traceStatus.classList.remove('active');
  }

  function formatKm(m) { return `${(Math.max(0,m)/1000).toFixed(3)} km`; }

  function updateTraceUI(covered) {
    if (!state.activeRoute || !state.selectedDp) return;
    const total = state.activeRoute.distance;
    ui.selectedNode.textContent = state.selectedDp.name;
    ui.destination.textContent = state.defaultFdc?.name || '—';
    ui.totalDistance.textContent = formatKm(total);
    ui.coveredDistance.textContent = formatKm(covered);
    ui.balanceDistance.textContent = formatKm(total - covered);
  }

  function routeMetric(latlngs) {
    const segs = []; let total = 0;
    for (let i=0;i<latlngs.length-1;i++) {
      const d = map.distance(latlngs[i], latlngs[i+1]); segs.push(d); total += d;
    }
    return { segs, total };
  }

  function pointAtDistance(latlngs, metric, target) {
    let acc = 0;
    for (let i=0;i<metric.segs.length;i++) {
      const d = metric.segs[i];
      if (acc + d >= target || i === metric.segs.length - 1) {
        const t = d === 0 ? 0 : Math.min(1, Math.max(0, (target - acc) / d));
        return L.latLng(
          latlngs[i].lat + (latlngs[i+1].lat - latlngs[i].lat) * t,
          latlngs[i].lng + (latlngs[i+1].lng - latlngs[i].lng) * t
        );
      }
      acc += d;
    }
    return latlngs[latlngs.length-1];
  }

  function speedDuration() {
    const distance = state.activeRoute?.distance || 1000;
    const normal = Math.max(7000, Math.min(22000, distance * 10));
    return state.speed === 'slow' ? normal * 1.7 : state.speed === 'fast' ? normal * .55 : normal;
  }

  function playTrace() {
    if (!state.activeRoute) return;
    if (state.playing) { stopAnimation(false); return; }
    const latlngs = state.activeRoute.latlngs;
    const metric = routeMetric(latlngs);
    const duration = speedDuration();
    const startProgress = state.progress >= .999 ? 0 : state.progress;
    const startTime = performance.now() - startProgress * duration;
    state.playing = true;
    ui.playText.textContent = 'Pause'; ui.playIcon.textContent = 'Ⅱ'; ui.traceStatus.textContent = 'Tracing';

    if (!state.mover) state.mover = L.marker(latlngs[0], { icon:moverIcon, zIndexOffset:2000, interactive:false }).addTo(map);
    let lastUi = 0;

    const tick = now => {
      if (!state.playing) return;
      const p = Math.min(1, (now - startTime) / duration);
      state.progress = p;
      const actualCovered = state.activeRoute.distance * p;
      const pt = pointAtDistance(latlngs, metric, metric.total * p);
      state.mover.setLatLng(pt);

      if (now - lastUi > 100) {
        updateTraceUI(actualCovered);
        ui.mapStatus.textContent = `${state.selectedDp.name} • ${formatKm(actualCovered)} covered • ${formatKm(state.activeRoute.distance-actualCovered)} balance`;
        lastUi = now;
      }
      if (now - state.lastPan > 350) {
        map.panTo(pt, { animate:true, duration:.28, easeLinearity:.35 });
        state.lastPan = now;
      }
      if (p < 1) state.animationId = requestAnimationFrame(tick);
      else {
        state.playing = false;
        ui.playText.textContent = 'Replay Trace'; ui.playIcon.textContent = '↻'; ui.traceStatus.textContent = 'Completed';
        updateTraceUI(state.activeRoute.distance);
        ui.mapStatus.textContent = `${state.selectedDp.name} trace completed at ${state.defaultFdc.name}`;
      }
    };
    state.animationId = requestAnimationFrame(tick);
  }

  function stopAnimation(resetButton = true) {
    state.playing = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    if (resetButton) { ui.playText.textContent = state.progress > 0 ? 'Resume Trace' : 'Play Trace'; ui.playIcon.textContent = '▶'; }
  }

  function resetTrace() {
    stopAnimation(); state.progress = 0;
    if (state.mover) { state.mover.remove(); state.mover = null; }
    if (state.activeRoute) {
      updateTraceUI(0);
      map.fitBounds(L.latLngBounds(state.activeRoute.latlngs), { padding:[42,42], maxZoom:18, animate:true });
      ui.mapStatus.textContent = `${state.selectedDp.name} → ${state.defaultFdc.name} • ${formatKm(state.activeRoute.distance)}`;
    }
    ui.traceStatus.textContent = 'Ready';
  }

  function searchItems(query) {
    const q = String(query || '').trim().toUpperCase();
    if (!q) return [];
    return [...state.dps, ...state.fdcs].filter(x => x.name.toUpperCase().includes(q)).slice(0, 10);
  }

  function renderSearchResults() {
    const items = searchItems(ui.searchInput.value);
    if (!items.length) { ui.searchResults.classList.add('hidden'); ui.searchResults.innerHTML=''; return; }
    ui.searchResults.innerHTML = items.map(x => `<button type="button" data-name="${escapeHtml(x.name)}"><span>${escapeHtml(x.name)}</span><small>${/^DP/i.test(x.name)?'DP':'FDC'}</small></button>`).join('');
    ui.searchResults.classList.remove('hidden');
  }

  function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function bindUI() {
    ui.searchInput.addEventListener('input', renderSearchResults);
    ui.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); traceFromSearch(); } });
    ui.searchResults.addEventListener('click', e => {
      const btn = e.target.closest('button[data-name]'); if (!btn) return;
      ui.searchInput.value = btn.dataset.name; ui.searchResults.classList.add('hidden');
      if (/^DP/i.test(btn.dataset.name)) selectAndTrace(btn.dataset.name, true);
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search-box')) ui.searchResults.classList.add('hidden'); });
    ui.traceBtn.addEventListener('click', traceFromSearch);
    ui.playBtn.addEventListener('click', playTrace);
    ui.resetBtn.addEventListener('click', resetTrace);
    ui.speedControl.addEventListener('click', e => {
      const btn = e.target.closest('button[data-speed]'); if (!btn) return;
      [...ui.speedControl.querySelectorAll('button')].forEach(x => x.classList.toggle('active', x === btn));
      state.speed = btn.dataset.speed;
      if (state.playing) { stopAnimation(false); playTrace(); }
    });
    document.querySelector('.map-layer-toggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-layer]'); if (!btn) return;
      const next = btn.dataset.layer; if (next === state.activeBaseLayer) return;
      map.removeLayer(state.baseLayers[state.activeBaseLayer]); state.baseLayers[next].addTo(map); state.baseLayers[next].bringToBack(); state.activeBaseLayer = next;
      document.querySelectorAll('.map-layer-toggle button').forEach(x => x.classList.toggle('active', x === btn));
    });
    ui.mobileDetailsBtn.addEventListener('click', () => ui.detailsPanel.classList.toggle('open'));
    ui.detailsPanel.addEventListener('click', e => { if (window.innerWidth <= 760 && e.target === ui.detailsPanel) ui.detailsPanel.classList.toggle('open'); });
  }

  function traceFromSearch() {
    const q = ui.searchInput.value.trim().toUpperCase();
    const dp = state.dps.find(x => x.name.toUpperCase() === q) || state.dps.find(x => x.name.toUpperCase().includes(q));
    if (dp) selectAndTrace(dp.name, true); else showError('Select a DP from search results.');
  }

  async function init() {
    bindUI();
    try {
      const parts = await Promise.all(DATA_URLS.map(async url => {
        const res = await fetch(`${url}?v=${Date.now()}`, { cache:'no-store' });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        return res.json();
      }));
      state.geojson = { type:'FeatureCollection', features:parts.flatMap(p => p.features || []) };
      buildTopology(state.geojson);
      ui.networkBadge.innerHTML = '<span class="status-dot"></span>Network Ready';
      if (state.dps.length) ui.mapStatus.textContent = `${state.dps.length} DP loaded • Tap any DP to trace`;
      const demo = state.dps.find(x => x.name.toUpperCase() === 'DP0008') || state.dps[0];
      if (demo) setTimeout(() => selectAndTrace(demo.name, false), 400);
    } catch (err) {
      console.error(err);
      ui.networkBadge.textContent = 'Data Error';
      showError('Unable to load fiber topology data.');
    }
  }

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
  init();
})();
