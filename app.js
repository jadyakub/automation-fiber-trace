(() => {
  'use strict';

  const DATA_URLS = [
    '/data/f14-kgu-c029m-1.geojson',
    '/data/f14-kgu-c029m-2.geojson',
    '/data/f14-kgu-c029m-3.geojson',
    '/data/f14-kgu-c029m-4.geojson'
  ];
  const DEFAULT_FDC = 'FDC KGU C029M';
  const SNAP_METERS = 5;
  const FD_ROUTE_TOLERANCE_METERS = 16;

  const state = {
    geojson: null,
    labels: [],
    dps: [],
    fdcs: [],
    joints: [],
    fds: [],
    graph: new Map(),
    nodeCoords: new Map(),
    defaultFdc: null,
    selectedDp: null,
    activeRoute: null,
    routeLayer: null,
    routeShadowLayer: null,
    directionLayer: null,
    mover: null,
    animationId: null,
    playing: false,
    speed: 'normal',
    progress: 0,
    baseLayers: {},
    activeBaseLayer: 'satellite',
    markerLayer: null,
    sourceRouteLayer: null,
    markerEntries: new Map(),
    markersByName: new Map(),
    lastPan: 0,
    topologyReport: null
  };

  const $ = id => document.getElementById(id);
  const ui = {
    searchInput: $('searchInput'), searchResults: $('searchResults'), traceBtn: $('traceBtn'),
    selectedNode: $('selectedNode'), destination: $('destination'), totalDistance: $('totalDistance'),
    coveredDistance: $('coveredDistance'), balanceDistance: $('balanceDistance'), fdCablePath: $('fdCablePath'),
    traceStatus: $('traceStatus'), playBtn: $('playBtn'), playText: $('playText'), playIcon: $('playIcon'),
    resetBtn: $('resetBtn'), speedControl: $('speedControl'), mapStatus: $('mapStatus'), detailsPanel: $('detailsPanel'),
    mobileDetailsBtn: $('mobileDetailsBtn'), networkBadge: $('networkBadge'), mobileTraceBar: $('mobileTraceBar'),
    mobileTraceInfo: $('mobileTraceInfo'), mobileTraceNode: $('mobileTraceNode'),
    mobileTraceDistance: $('mobileTraceDistance'), mobilePlayBtn: $('mobilePlayBtn')
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
  state.directionLayer = L.layerGroup().addTo(map);

  const iconText = { dp: 'D', fdc: 'F', jt: 'J', fd: 'FD' };
  const nodeIcon = type => L.divIcon({
    className: '',
    html: `<span class="node-marker ${type}" data-label="${iconText[type] || ''}"></span>`,
    iconSize: type === 'fdc' ? [26,26] : [22,22],
    iconAnchor: type === 'fdc' ? [13,13] : [11,11]
  });

  const moverIcon = L.divIcon({
    className: '',
    html: '<div class="trace-mover-wrap"><div class="trace-mover"></div></div>',
    iconSize: [40,40], iconAnchor: [20,20]
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

  function addEdge(a, b, weight, meta = {}) {
    const ak = coordKey(a), bk = coordKey(b);
    if (ak === bk) return;
    state.nodeCoords.set(ak, a); state.nodeCoords.set(bk, b);
    if (!state.graph.has(ak)) state.graph.set(ak, []);
    if (!state.graph.has(bk)) state.graph.set(bk, []);
    state.graph.get(ak).push({ to: bk, weight, ...meta });
    state.graph.get(bk).push({ to: ak, weight, ...meta });
  }

  function labelTypeName(name) {
    const n = String(name || '').trim();
    if (/^DP\d/i.test(n)) return 'dp';
    if (/^FDC\b/i.test(n)) return 'fdc';
    if (/^(JT|JOINT|CLOSURE)\b/i.test(n)) return 'jt';
    if (/^FD\d\b/i.test(n)) return 'fd';
    return null;
  }

  function buildTopology(data) {
    state.graph.clear(); state.nodeCoords.clear(); state.labels = [];
    const endpoints = [];
    const lineFeatures = [];

    data.features.forEach((f, idx) => {
      const g = f.geometry || {};
      const props = f.properties || {};
      if (g.type === 'Point') {
        const text = String(props?.__style?.text || props.name || '').trim();
        if (text) state.labels.push({ id: `p${idx}`, name: text, xy: [Number(g.coordinates[0]), Number(g.coordinates[1])], props });
      } else if (g.type === 'LineString') {
        const pts = g.coordinates.map(c => [Number(c[0]), Number(c[1])]);
        const color = String(props?.__style?.strokeColor || '#4d6a87').toUpperCase();
        lineFeatures.push({ idx, pts, props, color });
      }
    });

    state.dps = state.labels.filter(x => labelTypeName(x.name) === 'dp');
    state.fdcs = state.labels.filter(x => labelTypeName(x.name) === 'fdc');
    state.joints = state.labels.filter(x => labelTypeName(x.name) === 'jt');
    state.fds = state.labels.filter(x => labelTypeName(x.name) === 'fd');
    state.defaultFdc = state.fdcs.find(x => x.name.toUpperCase() === DEFAULT_FDC.toUpperCase()) || state.fdcs[0] || null;

    lineFeatures.forEach(({ idx, pts, color }) => {
      for (let i = 0; i < pts.length - 1; i++) {
        addEdge(pts[i], pts[i + 1], xyDistance(pts[i], pts[i + 1]), { color, feature: idx, snap: false });
      }
      if (pts.length) {
        endpoints.push({ xy: pts[0], color, feature: idx });
        endpoints.push({ xy: pts[pts.length - 1], color, feature: idx });
      }
    });

    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const a = endpoints[i], b = endpoints[j];
        const d = xyDistance(a.xy, b.xy);
        if (!(d > 0 && d <= SNAP_METERS)) continue;
        const sameColour = a.color === b.color;
        const namedConnection = connectionLabelNear(a.xy, b.xy, 12);
        if (sameColour || namedConnection) {
          addEdge(a.xy, b.xy, d, { color: 'SNAP', feature: null, snap: true });
        }
      }
    }

    drawSourceRoutes(lineFeatures);
    drawNodes();
    state.topologyReport = validateTopology();
    console.table(state.topologyReport.rows);
  }

  function connectionLabelNear(a, b, tolerance) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return state.labels.some(label => labelTypeName(label.name) && xyDistance(label.xy, mid) <= tolerance);
  }

  function drawSourceRoutes(lines) {
    state.sourceRouteLayer.clearLayers();
    const allLatLngs = [];
    lines.forEach(({ pts, color }) => {
      const latlngs = pts.map(p => {
        const [lng, lat] = toLngLat(p);
        allLatLngs.push([lat, lng]);
        return [lat, lng];
      });
      const displayColor = color === '#FF0000' ? '#ff3b30' : color === '#0000FF' ? '#2563eb' : color;
      L.polyline(latlngs, { color:'#ffffff', weight:5.2, opacity:.24, interactive:false }).addTo(state.sourceRouteLayer);
      L.polyline(latlngs, { color:displayColor, weight:3.0, opacity:.88, interactive:false }).addTo(state.sourceRouteLayer);
    });
    if (allLatLngs.length) map.fitBounds(L.latLngBounds(allLatLngs), { padding: [20, 20] });
  }

  function classify(label) {
    return labelTypeName(label.name);
  }

  function tooltipClass(type, permanent = false) {
    if (type === 'fd') return 'fd-label';
    return permanent && type === 'dp' ? 'node-label dp-selected' : 'node-label';
  }

  function bindMarkerTooltip(entry, permanent = false) {
    entry.marker.unbindTooltip();
    entry.marker.bindTooltip(entry.label.name, {
      permanent,
      direction: permanent && entry.type === 'fd' ? 'right' : 'top',
      offset: permanent && entry.type === 'fd' ? [10,0] : [0,-9],
      className: tooltipClass(entry.type, permanent),
      opacity: .98
    });
    if (permanent) entry.marker.openTooltip();
  }

  function drawNodes() {
    state.markerLayer.clearLayers(); state.markerEntries.clear(); state.markersByName.clear();
    state.labels.forEach(label => {
      const type = classify(label);
      if (!type) return;
      const [lng, lat] = toLngLat(label.xy);
      const marker = L.marker([lat, lng], { icon: nodeIcon(type), riseOnHover: true, keyboard: false }).addTo(state.markerLayer);
      const entry = { marker, label, type };
      state.markerEntries.set(label.id, entry);
      bindMarkerTooltip(entry, false);

      if (type === 'dp') marker.on('click', () => selectAndTrace(label.name, false));
      if (type === 'fdc') marker.on('click', () => {
        ui.destination.textContent = label.name;
        ui.mapStatus.textContent = `FDC: ${label.name}`;
      });
      if (!state.markersByName.has(label.name.toUpperCase())) state.markersByName.set(label.name.toUpperCase(), marker);
    });
  }

  function resetMarkerHighlights() {
    state.markerEntries.forEach(entry => {
      bindMarkerTooltip(entry, false);
      if (entry.marker._icon) entry.marker._icon.querySelector('.node-marker')?.classList.remove('fd-active');
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
          dist.set(edge.to, nd);
          prev.set(edge.to, { from: cur.key, edge });
          queue.push({ key: edge.to, d: nd });
        }
      }
    }
    if (!dist.has(endKey)) return null;
    const keys = [], edges = [];
    let k = endKey;
    while (k) {
      keys.push(k);
      if (k === startKey) break;
      const p = prev.get(k);
      if (!p) return null;
      edges.push(p.edge);
      k = p.from;
    }
    keys.reverse(); edges.reverse();
    return { keys, edges, distance: dist.get(endKey) };
  }

  function pointSegmentDistance(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = p[0] - a[0], wy = p[1] - a[1];
    const len2 = vx * vx + vy * vy;
    if (!len2) return xyDistance(p, a);
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    return xyDistance(p, [a[0] + t * vx, a[1] + t * vy]);
  }

  function distanceToPolyline(p, coords) {
    let best = Infinity;
    for (let i = 0; i < coords.length - 1; i++) best = Math.min(best, pointSegmentDistance(p, coords[i], coords[i + 1]));
    return best;
  }

  function findFdCablesAlongRoute(coords) {
    return state.fds.filter(fd => distanceToPolyline(fd.xy, coords) <= FD_ROUTE_TOLERANCE_METERS);
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
    const latlngs = coords.map(p => {
      const [lng, lat] = toLngLat(p);
      return L.latLng(lat, lng);
    });
    const fdLabels = findFdCablesAlongRoute(coords);
    return { coords, latlngs, distance, edges: result.edges, fdLabels };
  }

  function validateTopology() {
    if (!state.defaultFdc) return { connected:0, total:state.dps.length, rows:[] };
    const rows = state.dps
      .slice()
      .sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric:true }))
      .map(dp => {
        const route = findRoute(dp, state.defaultFdc);
        return {
          DP: dp.name,
          Connected: Boolean(route),
          'Distance km': route ? Number((route.distance / 1000).toFixed(3)) : null,
          'FD Cable': route ? [...new Set(route.fdLabels.map(x => x.name))].join(' / ') : ''
        };
      });
    return { connected: rows.filter(r => r.Connected).length, total: rows.length, rows };
  }

  function bearing(a, b) {
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dl = (b.lng - a.lng) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function routeMetric(latlngs) {
    const segs = []; let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      const d = map.distance(latlngs[i], latlngs[i + 1]);
      segs.push(d); total += d;
    }
    return { segs, total };
  }

  function pointAtDistance(latlngs, metric, target) {
    let acc = 0;
    for (let i = 0; i < metric.segs.length; i++) {
      const d = metric.segs[i];
      if (acc + d >= target || i === metric.segs.length - 1) {
        const t = d === 0 ? 0 : Math.min(1, Math.max(0, (target - acc) / d));
        return L.latLng(
          latlngs[i].lat + (latlngs[i + 1].lat - latlngs[i].lat) * t,
          latlngs[i].lng + (latlngs[i + 1].lng - latlngs[i].lng) * t
        );
      }
      acc += d;
    }
    return latlngs[latlngs.length - 1];
  }

  function renderDirectionArrows(latlngs) {
    state.directionLayer.clearLayers();
    const metric = routeMetric(latlngs);
    const fractions = metric.total < 500 ? [.28, .58, .82] : [.14, .32, .50, .68, .86];
    fractions.forEach(frac => {
      const d = metric.total * frac;
      const p = pointAtDistance(latlngs, metric, d);
      const p2 = pointAtDistance(latlngs, metric, Math.min(metric.total, d + Math.max(8, metric.total * .015)));
      const deg = bearing(p, p2);
      const icon = L.divIcon({
        className: '',
        html: `<div class="route-arrow-wrap"><div class="route-arrow" style="transform:rotate(${deg}deg)">➤</div></div>`,
        iconSize:[22,22], iconAnchor:[11,11]
      });
      L.marker(p, { icon, interactive:false, zIndexOffset:1200 }).addTo(state.directionLayer);
    });
  }

  function highlightRouteMarkers(route, dp) {
    resetMarkerHighlights();
    const dpEntry = [...state.markerEntries.values()].find(e => e.type === 'dp' && e.label.name.toUpperCase() === dp.name.toUpperCase());
    if (dpEntry) bindMarkerTooltip(dpEntry, true);
    route.fdLabels.forEach(fd => {
      const entry = state.markerEntries.get(fd.id);
      if (!entry) return;
      bindMarkerTooltip(entry, true);
      if (entry.marker._icon) entry.marker._icon.querySelector('.node-marker')?.classList.add('fd-active');
    });
  }

  function clearActiveRouteLayers() {
    if (state.routeLayer) { state.routeLayer.remove(); state.routeLayer = null; }
    if (state.routeShadowLayer) { state.routeShadowLayer.remove(); state.routeShadowLayer = null; }
    state.directionLayer.clearLayers();
  }

  function selectAndTrace(name, openMobilePanel = false) {
    stopAnimation(false);
    const dp = state.dps.find(x => x.name.toUpperCase() === String(name).toUpperCase());
    if (!dp || !state.defaultFdc) return showError('DP or FDC not found.');
    const route = findRoute(dp, state.defaultFdc);
    if (!route) return showError(`No connected route found for ${dp.name}.`);

    state.selectedDp = dp; state.activeRoute = route; state.progress = 0;
    if (state.mover) { state.mover.remove(); state.mover = null; }
    clearActiveRouteLayers();

    state.routeShadowLayer = L.polyline(route.latlngs, {
      color:'#1f2937', weight:11, opacity:.72, lineCap:'round', lineJoin:'round', interactive:false
    }).addTo(map);
    state.routeLayer = L.polyline(route.latlngs, {
      color:'#ffd800', weight:6.5, opacity:1, lineCap:'round', lineJoin:'round', interactive:false
    }).addTo(map);
    state.routeShadowLayer.bringToFront(); state.routeLayer.bringToFront();
    renderDirectionArrows(route.latlngs);
    highlightRouteMarkers(route, dp);

    map.fitBounds(state.routeLayer.getBounds(), { padding:[42,42], maxZoom:18, animate:true });
    updateTraceUI(0);
    ui.traceStatus.textContent = 'Ready'; ui.traceStatus.classList.add('active');
    ui.mapStatus.textContent = `${dp.name} → ${state.defaultFdc.name} • ${(route.distance / 1000).toFixed(3)} km`;
    ui.playBtn.disabled = false; ui.resetBtn.disabled = false; ui.mobilePlayBtn.disabled = false;
    ui.searchInput.value = dp.name;
    syncPlayButtons('ready');
    if (openMobilePanel && window.innerWidth <= 760) ui.detailsPanel.classList.add('open');
  }

  function showError(msg) {
    ui.mapStatus.textContent = msg;
    ui.traceStatus.textContent = 'No route'; ui.traceStatus.classList.remove('active');
  }

  function formatKm(m) {
    return `${(Math.max(0, m) / 1000).toFixed(3)} km`;
  }

  function updateTraceUI(covered) {
    if (!state.activeRoute || !state.selectedDp) return;
    const total = state.activeRoute.distance;
    const fdNames = [...new Set(state.activeRoute.fdLabels.map(x => x.name))];
    ui.selectedNode.textContent = state.selectedDp.name;
    ui.destination.textContent = state.defaultFdc?.name || '—';
    ui.totalDistance.textContent = formatKm(total);
    ui.coveredDistance.textContent = formatKm(covered);
    ui.balanceDistance.textContent = formatKm(total - covered);
    ui.fdCablePath.textContent = fdNames.length ? fdNames.join(' / ') : '—';
    ui.mobileTraceNode.textContent = `${state.selectedDp.name} → ${state.defaultFdc?.name || 'FDC'}`;
    ui.mobileTraceDistance.textContent = `${formatKm(covered)} covered • ${formatKm(total - covered)} balance`;
  }

  function speedDuration() {
    const distance = state.activeRoute?.distance || 1000;
    const normal = Math.max(7000, Math.min(22000, distance * 10));
    return state.speed === 'slow' ? normal * 1.7 : state.speed === 'fast' ? normal * .55 : normal;
  }

  function syncPlayButtons(mode) {
    if (mode === 'playing') {
      ui.playText.textContent = 'Pause'; ui.playIcon.textContent = 'Ⅱ'; ui.mobilePlayBtn.textContent = 'Ⅱ';
    } else if (mode === 'completed') {
      ui.playText.textContent = 'Replay Trace'; ui.playIcon.textContent = '↻'; ui.mobilePlayBtn.textContent = '↻';
    } else if (mode === 'paused') {
      ui.playText.textContent = 'Resume Trace'; ui.playIcon.textContent = '▶'; ui.mobilePlayBtn.textContent = '▶';
    } else {
      ui.playText.textContent = 'Play Trace'; ui.playIcon.textContent = '▶'; ui.mobilePlayBtn.textContent = '▶';
    }
  }

  function playTrace() {
    if (!state.activeRoute) return;
    if (state.playing) { stopAnimation(true); return; }

    const latlngs = state.activeRoute.latlngs;
    const metric = routeMetric(latlngs);
    const duration = speedDuration();
    const startProgress = state.progress >= .999 ? 0 : state.progress;
    const startTime = performance.now() - startProgress * duration;
    state.playing = true;
    ui.traceStatus.textContent = 'Tracing';
    syncPlayButtons('playing');

    if (!state.mover) state.mover = L.marker(latlngs[0], { icon:moverIcon, zIndexOffset:2000, interactive:false }).addTo(map);
    let lastUi = 0;

    const tick = now => {
      if (!state.playing) return;
      const p = Math.min(1, (now - startTime) / duration);
      state.progress = p;
      const actualCovered = state.activeRoute.distance * p;
      const pt = pointAtDistance(latlngs, metric, metric.total * p);
      state.mover.setLatLng(pt);

      if (now - lastUi > 90) {
        updateTraceUI(actualCovered);
        ui.mapStatus.textContent = `${state.selectedDp.name} • ${formatKm(actualCovered)} covered • ${formatKm(state.activeRoute.distance - actualCovered)} balance`;
        lastUi = now;
      }
      if (now - state.lastPan > 320) {
        map.panTo(pt, { animate:true, duration:.25, easeLinearity:.35 });
        state.lastPan = now;
      }
      if (p < 1) {
        state.animationId = requestAnimationFrame(tick);
      } else {
        state.playing = false;
        ui.traceStatus.textContent = 'Completed';
        updateTraceUI(state.activeRoute.distance);
        syncPlayButtons('completed');
        ui.mapStatus.textContent = `${state.selectedDp.name} trace completed at ${state.defaultFdc.name}`;
      }
    };
    state.animationId = requestAnimationFrame(tick);
  }

  function stopAnimation(updateButtons = true) {
    state.playing = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    if (updateButtons && state.activeRoute) syncPlayButtons(state.progress > 0 ? 'paused' : 'ready');
  }

  function resetTrace() {
    stopAnimation(false); state.progress = 0;
    if (state.mover) { state.mover.remove(); state.mover = null; }
    if (state.activeRoute) {
      updateTraceUI(0);
      map.fitBounds(L.latLngBounds(state.activeRoute.latlngs), { padding:[42,42], maxZoom:18, animate:true });
      ui.mapStatus.textContent = `${state.selectedDp.name} → ${state.defaultFdc.name} • ${formatKm(state.activeRoute.distance)}`;
    }
    ui.traceStatus.textContent = 'Ready';
    syncPlayButtons('ready');
  }

  function searchItems(query) {
    const q = String(query || '').trim().toUpperCase();
    if (!q) return [];
    return [...state.dps, ...state.fdcs].filter(x => x.name.toUpperCase().includes(q)).slice(0, 10);
  }

  function renderSearchResults() {
    const items = searchItems(ui.searchInput.value);
    if (!items.length) {
      ui.searchResults.classList.add('hidden'); ui.searchResults.innerHTML = ''; return;
    }
    ui.searchResults.innerHTML = items.map(x =>
      `<button type="button" data-name="${escapeHtml(x.name)}"><span>${escapeHtml(x.name)}</span><small>${/^DP/i.test(x.name) ? 'DP' : 'FDC'}</small></button>`
    ).join('');
    ui.searchResults.classList.remove('hidden');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }

  function bindUI() {
    ui.searchInput.addEventListener('input', renderSearchResults);
    ui.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); traceFromSearch(); }
    });
    ui.searchResults.addEventListener('click', e => {
      const btn = e.target.closest('button[data-name]'); if (!btn) return;
      ui.searchInput.value = btn.dataset.name;
      ui.searchResults.classList.add('hidden');
      if (/^DP/i.test(btn.dataset.name)) selectAndTrace(btn.dataset.name, false);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.search-box')) ui.searchResults.classList.add('hidden');
    });
    ui.traceBtn.addEventListener('click', traceFromSearch);
    ui.playBtn.addEventListener('click', playTrace);
    ui.mobilePlayBtn.addEventListener('click', playTrace);
    ui.resetBtn.addEventListener('click', resetTrace);
    ui.mobileTraceInfo.addEventListener('click', () => ui.detailsPanel.classList.add('open'));

    ui.speedControl.addEventListener('click', e => {
      const btn = e.target.closest('button[data-speed]'); if (!btn) return;
      [...ui.speedControl.querySelectorAll('button')].forEach(x => x.classList.toggle('active', x === btn));
      state.speed = btn.dataset.speed;
      if (state.playing) { stopAnimation(false); playTrace(); }
    });

    document.querySelector('.map-layer-toggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-layer]'); if (!btn) return;
      const next = btn.dataset.layer;
      if (next === state.activeBaseLayer) return;
      map.removeLayer(state.baseLayers[state.activeBaseLayer]);
      state.baseLayers[next].addTo(map); state.baseLayers[next].bringToBack();
      state.activeBaseLayer = next;
      document.querySelectorAll('.map-layer-toggle button').forEach(x => x.classList.toggle('active', x === btn));
    });

    ui.mobileDetailsBtn.addEventListener('click', () => ui.detailsPanel.classList.toggle('open'));
  }

  function traceFromSearch() {
    const q = ui.searchInput.value.trim().toUpperCase();
    const dp = state.dps.find(x => x.name.toUpperCase() === q) || state.dps.find(x => x.name.toUpperCase().includes(q));
    if (dp) selectAndTrace(dp.name, false);
    else showError('Select a DP from search results.');
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

      const report = state.topologyReport;
      if (report && report.connected === report.total) {
        ui.networkBadge.innerHTML = `<span class="status-dot"></span>Topology ${report.connected}/${report.total} Ready`;
      } else {
        ui.networkBadge.textContent = `Topology ${report?.connected || 0}/${report?.total || state.dps.length}`;
      }
      if (state.dps.length) ui.mapStatus.textContent = `${state.dps.length} DP loaded • Tap any DP to trace`;

      const demo = state.dps.find(x => x.name.toUpperCase() === 'DP0008') || state.dps[0];
      if (demo) setTimeout(() => selectAndTrace(demo.name, false), 400);
    } catch (err) {
      console.error(err);
      ui.networkBadge.textContent = 'Data Error';
      showError('Unable to load fiber topology data.');
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  init();
})();
