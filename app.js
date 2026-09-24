(() => {
  'use strict';

  const NETWORK_CONFIGS = [
    {
      id: 'C029M',
      fdcName: 'FDC KGU C029M',
      dataUrls: [
        '/data/f14-kgu-c029m-1.geojson',
        '/data/f14-kgu-c029m-2.geojson',
        '/data/f14-kgu-c029m-3.geojson',
        '/data/f14-kgu-c029m-4.geojson'
      ]
    },
    {
      id: 'C045M',
      fdcName: 'FDC KGU C045M',
      dataUrls: [
        '/data/f14-kgu-c045m.geojson'
      ]
    },
    {
      id: 'C046M',
      fdcName: 'FDC KGU C046M',
      dataUrls: [
        '/data/f14-kgu-c046m-1.geojson',
        '/data/f14-kgu-c046m-2.geojson',
        '/data/f14-kgu-c046m-3.geojson',
        '/data/f14-kgu-c046m-4.geojson',
        '/data/f14-kgu-c046m-5.geojson',
        '/data/f14-kgu-c046m-6.geojson'
      ]
    }
  ];

  const SNAP_METERS = 5;
  const FD_ROUTE_TOLERANCE_METERS = 16;

  const state = {
    networks: new Map(),
    allDps: [],
    allFdcs: [],
    allFds: [],
    selectedDp: null,
    activeNetwork: null,
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
    markerDedup: new Set(),
    lastPan: 0,
    topologyReports: [],
    faultMarker: null,
    faultSegmentLayer: null,
    faultGps: null,
    selectedSearchDp: null,
    fdcView: 'ALL'
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
    mobileTraceDistance: $('mobileTraceDistance'), mobilePlayBtn: $('mobilePlayBtn'),
    faultStartSelect: $('faultStartSelect'), faultSelectedStart: $('faultSelectedStart'),
    faultDistanceInput: $('faultDistanceInput'), locateFaultBtn: $('locateFaultBtn'),
    faultStatus: $('faultStatus'), faultResult: $('faultResult'), faultGps: $('faultGps'),
    faultFromStart: $('faultFromStart'), faultBalance: $('faultBalance'),
    faultGoogleMapsBtn: $('faultGoogleMapsBtn'),
    mobileSheetClose: $('mobileSheetClose'), mobileDashboardBtn: $('mobileDashboardBtn'),
    mobileFaultBtn: $('mobileFaultBtn'), mobileSheetSubtitle: $('mobileSheetSubtitle'),
    otdrFaultCard: $('otdrFaultCard'), fdcViewSelect: $('fdcViewSelect')
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

  const faultIcon = L.divIcon({
    className: '',
    html: '<div class="fault-marker-wrap"><div class="fault-marker">✂</div></div>',
    iconSize: [44,44], iconAnchor: [22,22]
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

  function labelTypeName(name) {
    const n = String(name || '').trim();
    if (/^(DP|FDP)\d/i.test(n) || /_(DP|FDP)\d/i.test(n)) return 'dp';
    if (/^FDC\b/i.test(n)) return 'fdc';
    if (/^(JT|JOINT|CLOSURE)\b/i.test(n)) return 'jt';
    if (/^FD\d\b/i.test(n)) return 'fd';
    return null;
  }

  function createNetwork(config, data) {
    const network = {
      id: config.id,
      fdcName: config.fdcName,
      labels: [],
      dps: [],
      fdcs: [],
      joints: [],
      fds: [],
      graph: new Map(),
      nodeCoords: new Map(),
      lineFeatures: [],
      targetFdc: null,
      report: null,
      usedFeatures: new Set(),
      relevantLineFeatures: []
    };

    function addEdge(a, b, weight, meta = {}) {
      const ak = coordKey(a), bk = coordKey(b);
      if (ak === bk) return;
      network.nodeCoords.set(ak, a);
      network.nodeCoords.set(bk, b);
      if (!network.graph.has(ak)) network.graph.set(ak, []);
      if (!network.graph.has(bk)) network.graph.set(bk, []);
      network.graph.get(ak).push({ to: bk, weight, ...meta });
      network.graph.get(bk).push({ to: ak, weight, ...meta });
    }

    const endpoints = [];
    data.features.forEach((feature, idx) => {
      const geometry = feature.geometry || {};
      const props = feature.properties || {};
      if (geometry.type === 'Point') {
        const name = String(props?.__style?.text || props.name || '').trim();
        if (name) {
          network.labels.push({
            id: `${network.id}:p${idx}`,
            networkId: network.id,
            name,
            xy: [Number(geometry.coordinates[0]), Number(geometry.coordinates[1])],
            props
          });
        }
      } else if (geometry.type === 'LineString') {
        const pts = geometry.coordinates.map(c => [Number(c[0]), Number(c[1])]);
        const color = String(props?.__style?.strokeColor || '#4d6a87').toUpperCase();
        network.lineFeatures.push({ idx, pts, color, props });
      }
    });

    network.dps = network.labels.filter(x => labelTypeName(x.name) === 'dp');
    network.fdcs = network.labels.filter(x => labelTypeName(x.name) === 'fdc');
    network.joints = network.labels.filter(x => labelTypeName(x.name) === 'jt');
    network.fds = network.labels.filter(x => labelTypeName(x.name) === 'fd');
    network.targetFdc = network.fdcs.find(x => x.name.toUpperCase() === network.fdcName.toUpperCase()) || null;

    network.lineFeatures.forEach(({ idx, pts, color }) => {
      for (let i = 0; i < pts.length - 1; i++) {
        addEdge(pts[i], pts[i + 1], xyDistance(pts[i], pts[i + 1]), { color, feature: idx, snap: false });
      }
      if (pts.length) {
        endpoints.push({ xy: pts[0], color, feature: idx });
        endpoints.push({ xy: pts[pts.length - 1], color, feature: idx });
      }
    });

    const connectionLabelNear = (a, b, tolerance) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return network.labels.some(label => labelTypeName(label.name) && xyDistance(label.xy, mid) <= tolerance);
    };

    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const a = endpoints[i], b = endpoints[j];
        const distance = xyDistance(a.xy, b.xy);
        if (!(distance > 0 && distance <= SNAP_METERS)) continue;
        const sameColour = a.color === b.color;
        const namedConnection = connectionLabelNear(a.xy, b.xy, 12);
        if (sameColour || namedConnection) {
          addEdge(a.xy, b.xy, distance, { color:'SNAP', feature:null, snap:true });
        }
      }
    }

    return network;
  }

  function nearestGraphKey(network, xy, max = 80) {
    let best = null, bestD = Infinity;
    for (const [key, node] of network.nodeCoords.entries()) {
      const distance = xyDistance(xy, node);
      if (distance < bestD) { best = key; bestD = distance; }
    }
    return bestD <= max ? { key:best, distance:bestD } : null;
  }

  function dijkstra(network, startKey, endKey) {
    const dist = new Map([[startKey, 0]]);
    const prev = new Map();
    const visited = new Set();
    const queue = [{ key:startKey, d:0 }];

    while (queue.length) {
      queue.sort((a,b) => a.d - b.d);
      const cur = queue.shift();
      if (visited.has(cur.key)) continue;
      visited.add(cur.key);
      if (cur.key === endKey) break;

      for (const edge of network.graph.get(cur.key) || []) {
        if (visited.has(edge.to)) continue;
        const nd = cur.d + edge.weight;
        if (nd < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nd);
          prev.set(edge.to, { from:cur.key, edge });
          queue.push({ key:edge.to, d:nd });
        }
      }
    }

    if (!dist.has(endKey)) return null;
    const keys = [], edges = [];
    let key = endKey;
    while (key) {
      keys.push(key);
      if (key === startKey) break;
      const p = prev.get(key);
      if (!p) return null;
      edges.push(p.edge);
      key = p.from;
    }
    keys.reverse();
    edges.reverse();
    return { keys, edges, distance:dist.get(endKey) };
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
    for (let i = 0; i < coords.length - 1; i++) {
      best = Math.min(best, pointSegmentDistance(p, coords[i], coords[i + 1]));
    }
    return best;
  }

  function findFdCablesAlongRoute(network, coords) {
    return network.fds.filter(fd => distanceToPolyline(fd.xy, coords) <= FD_ROUTE_TOLERANCE_METERS);
  }

  function findRoute(dp, network = state.networks.get(dp.networkId)) {
    if (!network?.targetFdc) return null;
    const start = nearestGraphKey(network, dp.xy);
    const end = nearestGraphKey(network, network.targetFdc.xy);
    if (!start || !end) return null;

    const result = dijkstra(network, start.key, end.key);
    if (!result) return null;

    const coords = result.keys.map(key => network.nodeCoords.get(key));
    if (xyDistance(dp.xy, coords[0]) > .01) coords.unshift(dp.xy);
    if (xyDistance(network.targetFdc.xy, coords[coords.length - 1]) > .01) coords.push(network.targetFdc.xy);

    const distance = result.distance + start.distance + end.distance;
    const latlngs = coords.map(p => {
      const [lng, lat] = toLngLat(p);
      return L.latLng(lat, lng);
    });
    const fdLabels = findFdCablesAlongRoute(network, coords);

    return {
      networkId: network.id,
      destination: network.targetFdc,
      coords,
      latlngs,
      distance,
      edges: result.edges,
      fdLabels
    };
  }

  function validateNetwork(network) {
    network.usedFeatures.clear();

    const rows = network.dps
      .slice()
      .sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric:true }))
      .map(dp => {
        const route = findRoute(dp, network);
        if (route) {
          route.edges.forEach(edge => {
            if (Number.isInteger(edge.feature)) network.usedFeatures.add(edge.feature);
          });
        }
        return {
          Network: network.id,
          DP: dp.name,
          Connected: Boolean(route),
          'Distance km': route ? Number((route.distance / 1000).toFixed(3)) : null,
          'FD Cable': route ? [...new Set(route.fdLabels.map(x => x.name))].join(' / ') : ''
        };
      });

    network.relevantLineFeatures = network.lineFeatures.filter(line =>
      !network.usedFeatures.size || network.usedFeatures.has(line.idx)
    );

    network.report = {
      connected: rows.filter(row => row.Connected).length,
      total: rows.length,
      rows
    };
    return network.report;
  }

  function visibleNetworkList() {
    if (state.fdcView === 'ALL') return [...state.networks.values()];
    const network = state.networks.get(state.fdcView);
    return network ? [network] : [];
  }

  function drawSourceRoutes({ fit = false } = {}) {
    state.sourceRouteLayer.clearLayers();
    const allLatLngs = [];
    const seen = new Set();

    visibleNetworkList().forEach(network => {
      const routeLines = network.relevantLineFeatures.length
        ? network.relevantLineFeatures
        : network.lineFeatures;

      routeLines.forEach(({ pts, color }) => {
        const geometryKey = color + '|' + pts.map(p => coordKey(p)).join(';');
        if (seen.has(geometryKey)) return;
        seen.add(geometryKey);

        const latlngs = pts.map(p => {
          const [lng, lat] = toLngLat(p);
          allLatLngs.push([lat, lng]);
          return [lat, lng];
        });

        const displayColor = color === '#FF0000' ? '#ff3b30' : color === '#0000FF' ? '#2563eb' : color;
        L.polyline(latlngs, { color:'#ffffff', weight:5.2, opacity:.22, interactive:false }).addTo(state.sourceRouteLayer);
        L.polyline(latlngs, { color:displayColor, weight:3, opacity:.83, interactive:false }).addTo(state.sourceRouteLayer);
      });
    });

    if (fit && allLatLngs.length) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding:[28,28] });
    }
  }

  function markerDedupKey(label, type) {
    return `${type}|${label.name.toUpperCase()}|${coordKey(label.xy)}`;
  }

  function tooltipClass(type, permanent = false) {
    if (type === 'fd') return 'fd-label';
    return permanent && type === 'dp' ? 'node-label dp-selected' : 'node-label';
  }

  function bindMarkerTooltip(entry, permanent = false) {
    entry.marker.unbindTooltip();
    const suffix = entry.type === 'dp' ? ` · ${entry.label.networkId}` : '';
    entry.marker.bindTooltip(entry.label.name + suffix, {
      permanent,
      direction: permanent && entry.type === 'fd' ? 'right' : 'top',
      offset: permanent && entry.type === 'fd' ? [10,0] : [0,-9],
      className: tooltipClass(entry.type, permanent),
      opacity:.98
    });
    if (permanent) entry.marker.openTooltip();
  }

  function labelTouchesRelevantRoute(network, label, tolerance = 18) {
    const lines = network.relevantLineFeatures.length
      ? network.relevantLineFeatures
      : network.lineFeatures;
    return lines.some(line => distanceToPolyline(label.xy, line.pts) <= tolerance);
  }

  function drawNodes() {
    state.markerLayer.clearLayers();
    state.markerEntries.clear();
    state.markerDedup.clear();

    visibleNetworkList().forEach(network => {
      network.labels.forEach(label => {
        const type = labelTypeName(label.name);
        if (!type) return;

        // Only show the target FDC for each registered topology.
        if (type === 'fdc' && label.name.toUpperCase() !== network.fdcName.toUpperCase()) return;

        // Hide JT/FD labels that are not part of the selected FDC topology.
        if ((type === 'jt' || type === 'fd') && !labelTouchesRelevantRoute(network, label)) return;

        const dedupKey = markerDedupKey(label, type);
        if (state.markerDedup.has(dedupKey) && type !== 'dp') return;
        state.markerDedup.add(dedupKey);

        const [lng, lat] = toLngLat(label.xy);
        const marker = L.marker([lat,lng], {
          icon:nodeIcon(type),
          riseOnHover:true,
          keyboard:false
        }).addTo(state.markerLayer);

        const entry = { marker, label, type };
        state.markerEntries.set(label.id, entry);
        bindMarkerTooltip(entry, false);

        if (type === 'dp') {
          marker.on('click', () => selectAndTrace(label, false));
        } else if (type === 'fdc') {
          marker.on('click', () => {
            setFdcView(network.id, { fit:true, clearTrace:true });
            ui.destination.textContent = label.name;
            ui.mapStatus.textContent = `FDC Focus: ${label.name}`;
          });
        }
      });
    });
  }

  function populateFdcView() {
    ui.fdcViewSelect.innerHTML =
      '<option value="ALL">All FDC</option>' +
      NETWORK_CONFIGS.map(config =>
        `<option value="${escapeHtml(config.id)}">${escapeHtml(config.id)}</option>`
      ).join('');
    ui.fdcViewSelect.value = state.fdcView;
  }

  function clearTraceSelectionForView() {
    stopAnimation(false);
    clearFaultLocator(false);
    clearActiveRouteLayers();

    if (state.mover) {
      state.mover.remove();
      state.mover = null;
    }

    state.selectedDp = null;
    state.selectedSearchDp = null;
    state.activeNetwork = null;
    state.activeRoute = null;
    state.progress = 0;

    ui.selectedNode.textContent = '—';
    ui.totalDistance.textContent = '—';
    ui.coveredDistance.textContent = '—';
    ui.balanceDistance.textContent = '—';
    ui.fdCablePath.textContent = '—';
    ui.traceStatus.textContent = 'Idle';
    ui.traceStatus.classList.remove('active');
    ui.playBtn.disabled = true;
    ui.resetBtn.disabled = true;
    ui.mobilePlayBtn.disabled = true;
    syncPlayButtons('ready');

    const selectedNetwork = state.networks.get(state.fdcView);
    ui.destination.textContent = selectedNetwork?.targetFdc?.name || '—';
    ui.mobileTraceNode.textContent = state.fdcView === 'ALL' ? 'All FDC' : `${state.fdcView} Focus`;
    ui.mobileTraceDistance.textContent = 'Select a DP to trace';
  }

  function setFdcView(value, { fit = true, clearTrace = false } = {}) {
    const next = value === 'ALL' || state.networks.has(value) ? value : 'ALL';
    const changed = state.fdcView !== next;
    state.fdcView = next;
    ui.fdcViewSelect.value = next;

    if (clearTrace) clearTraceSelectionForView();

    drawSourceRoutes({ fit });
    drawNodes();

    if (!clearTrace && state.activeRoute && state.activeNetwork &&
        (state.fdcView === 'ALL' || state.activeNetwork.id === state.fdcView)) {
      highlightRouteMarkers(state.activeRoute, state.selectedDp);
    }

    if (changed || clearTrace) {
      ui.mapStatus.textContent = next === 'ALL'
        ? `All FDC routes visible • ${state.allDps.length} DP`
        : `${next} focused • Other FDC routes hidden`;
    }
  }

  function resetMarkerHighlights() {
    state.markerEntries.forEach(entry => {
      bindMarkerTooltip(entry, false);
      if (entry.marker._icon) {
        entry.marker._icon.querySelector('.node-marker')?.classList.remove('fd-active');
      }
    });
  }

  function highlightRouteMarkers(route, dp) {
    resetMarkerHighlights();

    const dpEntry = state.markerEntries.get(dp.id);
    if (dpEntry) bindMarkerTooltip(dpEntry, true);

    route.fdLabels.forEach(fd => {
      const entry = state.markerEntries.get(fd.id);
      if (!entry) return;
      bindMarkerTooltip(entry, true);
      if (entry.marker._icon) {
        entry.marker._icon.querySelector('.node-marker')?.classList.add('fd-active');
      }
    });
  }

  function bearing(a, b) {
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dl = (b.lng - a.lng) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function routeMetric(latlngs) {
    const segs = [];
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      const distance = map.distance(latlngs[i], latlngs[i + 1]);
      segs.push(distance);
      total += distance;
    }
    return { segs, total };
  }

  function pointAtDistance(latlngs, metric, target) {
    let acc = 0;
    for (let i = 0; i < metric.segs.length; i++) {
      const distance = metric.segs[i];
      if (acc + distance >= target || i === metric.segs.length - 1) {
        const t = distance === 0 ? 0 : Math.min(1, Math.max(0, (target - acc) / distance));
        return L.latLng(
          latlngs[i].lat + (latlngs[i + 1].lat - latlngs[i].lat) * t,
          latlngs[i].lng + (latlngs[i + 1].lng - latlngs[i].lng) * t
        );
      }
      acc += distance;
    }
    return latlngs[latlngs.length - 1];
  }

  function renderDirectionArrows(latlngs) {
    state.directionLayer.clearLayers();
    const metric = routeMetric(latlngs);
    const fractions = metric.total < 500 ? [.28,.58,.82] : [.14,.32,.50,.68,.86];

    fractions.forEach(frac => {
      const distance = metric.total * frac;
      const p = pointAtDistance(latlngs, metric, distance);
      const p2 = pointAtDistance(latlngs, metric, Math.min(metric.total, distance + Math.max(8, metric.total * .015)));
      const deg = bearing(p, p2);
      const icon = L.divIcon({
        className:'',
        html:`<div class="route-arrow-wrap"><div class="route-arrow" style="transform:rotate(${deg}deg)">➤</div></div>`,
        iconSize:[22,22],
        iconAnchor:[11,11]
      });
      L.marker(p, { icon, interactive:false, zIndexOffset:1200 }).addTo(state.directionLayer);
    });
  }

  function clearActiveRouteLayers() {
    if (state.routeLayer) { state.routeLayer.remove(); state.routeLayer = null; }
    if (state.routeShadowLayer) { state.routeShadowLayer.remove(); state.routeShadowLayer = null; }
    state.directionLayer.clearLayers();
  }

  function selectAndTrace(dp, openMobilePanel = false) {
    if (!dp) return showError('DP/FDP not found.');
    const network = state.networks.get(dp.networkId);
    if (!network?.targetFdc) return showError('FDC for this route is not registered.');

    stopAnimation(false);
    clearFaultLocator(false);

    const route = findRoute(dp, network);
    if (!route) return showError(`No connected route found for ${dp.name} · ${network.id}.`);

    state.selectedDp = dp;
    state.selectedSearchDp = dp;
    state.activeNetwork = network;
    state.activeRoute = route;
    state.progress = 0;

    // Auto-focus the selected DP's FDC so other network routes disappear.
    if (state.fdcView !== network.id) {
      state.fdcView = network.id;
      ui.fdcViewSelect.value = network.id;
      drawSourceRoutes({ fit:false });
      drawNodes();
    }

    if (state.mover) { state.mover.remove(); state.mover = null; }
    clearActiveRouteLayers();

    state.routeShadowLayer = L.polyline(route.latlngs, {
      color:'#1f2937', weight:11, opacity:.72, lineCap:'round', lineJoin:'round', interactive:false
    }).addTo(map);

    state.routeLayer = L.polyline(route.latlngs, {
      color:'#ffd800', weight:6.5, opacity:1, lineCap:'round', lineJoin:'round', interactive:false
    }).addTo(map);

    state.routeShadowLayer.bringToFront();
    state.routeLayer.bringToFront();
    renderDirectionArrows(route.latlngs);
    highlightRouteMarkers(route, dp);

    map.fitBounds(state.routeLayer.getBounds(), { padding:[42,42], maxZoom:18, animate:true });
    updateTraceUI(0);

    ui.traceStatus.textContent = 'Ready';
    ui.traceStatus.classList.add('active');
    ui.mapStatus.textContent = `${dp.name} · ${network.id} → ${network.targetFdc.name} • ${(route.distance/1000).toFixed(3)} km`;
    ui.playBtn.disabled = false;
    ui.resetBtn.disabled = false;
    ui.mobilePlayBtn.disabled = false;
    ui.searchInput.value = dp.name;
    syncFaultStart(dp);
    syncPlayButtons('ready');

    if (window.innerWidth <= 760 && !openMobilePanel) {
      ui.detailsPanel.classList.remove('open');
      setMobileNavActive(ui.mobileDashboardBtn);
    }
    if (openMobilePanel && window.innerWidth <= 760) openMobileSheet('details');
  }

  function showError(message) {
    ui.mapStatus.textContent = message;
    ui.traceStatus.textContent = 'No route';
    ui.traceStatus.classList.remove('active');
  }

  function formatKm(m) {
    return `${(Math.max(0,m)/1000).toFixed(3)} km`;
  }

  function updateTraceUI(covered) {
    if (!state.activeRoute || !state.selectedDp || !state.activeNetwork) return;
    const total = state.activeRoute.distance;
    const fdNames = [...new Set(state.activeRoute.fdLabels.map(x => x.name))];

    ui.selectedNode.textContent = `${state.selectedDp.name} · ${state.activeNetwork.id}`;
    ui.destination.textContent = state.activeNetwork.targetFdc?.name || '—';
    ui.totalDistance.textContent = formatKm(total);
    ui.coveredDistance.textContent = formatKm(covered);
    ui.balanceDistance.textContent = formatKm(total - covered);
    ui.fdCablePath.textContent = fdNames.length ? fdNames.join(' / ') : '—';

    ui.mobileTraceNode.textContent = `${state.selectedDp.name} · ${state.activeNetwork.id} → ${state.activeNetwork.targetFdc?.name || 'FDC'}`;
    ui.mobileTraceDistance.textContent = `${formatKm(covered)} covered • ${formatKm(total - covered)} balance`;
  }

  function speedDuration() {
    const distance = state.activeRoute?.distance || 1000;
    const normal = Math.max(7000, Math.min(22000, distance * 10));
    return state.speed === 'slow' ? normal * 1.7 : state.speed === 'fast' ? normal * .55 : normal;
  }

  function syncPlayButtons(mode) {
    if (mode === 'playing') {
      ui.playText.textContent = 'Pause';
      ui.playIcon.textContent = 'Ⅱ';
      ui.mobilePlayBtn.textContent = 'Ⅱ';
    } else if (mode === 'completed') {
      ui.playText.textContent = 'Replay Trace';
      ui.playIcon.textContent = '↻';
      ui.mobilePlayBtn.textContent = '↻';
    } else if (mode === 'paused') {
      ui.playText.textContent = 'Resume Trace';
      ui.playIcon.textContent = '▶';
      ui.mobilePlayBtn.textContent = '▶';
    } else {
      ui.playText.textContent = 'Play Trace';
      ui.playIcon.textContent = '▶';
      ui.mobilePlayBtn.textContent = '▶';
    }
  }

  function playTrace() {
    if (!state.activeRoute) return;
    if (state.playing) {
      stopAnimation(true);
      return;
    }

    const latlngs = state.activeRoute.latlngs;
    const metric = routeMetric(latlngs);
    const duration = speedDuration();
    const startProgress = state.progress >= .999 ? 0 : state.progress;
    const startTime = performance.now() - startProgress * duration;
    state.playing = true;
    ui.traceStatus.textContent = 'Tracing';
    syncPlayButtons('playing');

    if (!state.mover) {
      state.mover = L.marker(latlngs[0], {
        icon:moverIcon,
        zIndexOffset:2000,
        interactive:false
      }).addTo(map);
    }

    let lastUi = 0;
    const tick = now => {
      if (!state.playing) return;
      const progress = Math.min(1, (now - startTime) / duration);
      state.progress = progress;

      const actualCovered = state.activeRoute.distance * progress;
      const point = pointAtDistance(latlngs, metric, metric.total * progress);
      state.mover.setLatLng(point);

      if (now - lastUi > 90) {
        updateTraceUI(actualCovered);
        ui.mapStatus.textContent = `${state.selectedDp.name} · ${state.activeNetwork.id} • ${formatKm(actualCovered)} covered • ${formatKm(state.activeRoute.distance - actualCovered)} balance`;
        lastUi = now;
      }

      if (now - state.lastPan > 320) {
        map.panTo(point, { animate:true, duration:.25, easeLinearity:.35 });
        state.lastPan = now;
      }

      if (progress < 1) {
        state.animationId = requestAnimationFrame(tick);
      } else {
        state.playing = false;
        ui.traceStatus.textContent = 'Completed';
        updateTraceUI(state.activeRoute.distance);
        syncPlayButtons('completed');
        ui.mapStatus.textContent = `${state.selectedDp.name} trace completed at ${state.activeNetwork.targetFdc.name}`;
      }
    };

    state.animationId = requestAnimationFrame(tick);
  }

  function stopAnimation(updateButtons = true) {
    state.playing = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    if (updateButtons && state.activeRoute) {
      syncPlayButtons(state.progress > 0 ? 'paused' : 'ready');
    }
  }

  function resetTrace() {
    stopAnimation(false);
    state.progress = 0;
    if (state.mover) {
      state.mover.remove();
      state.mover = null;
    }
    if (state.activeRoute) {
      updateTraceUI(0);
      map.fitBounds(L.latLngBounds(state.activeRoute.latlngs), {
        padding:[42,42], maxZoom:18, animate:true
      });
      ui.mapStatus.textContent = `${state.selectedDp.name} · ${state.activeNetwork.id} → ${state.activeNetwork.targetFdc.name} • ${formatKm(state.activeRoute.distance)}`;
    }
    ui.traceStatus.textContent = 'Ready';
    syncPlayButtons('ready');
  }

  function populateFaultStarts() {
    const sorted = state.allDps
      .slice()
      .sort((a,b) => a.networkId.localeCompare(b.networkId) || a.name.localeCompare(b.name, undefined, { numeric:true }));

    ui.faultStartSelect.innerHTML =
      '<option value="">Select FDP/DP</option>' +
      sorted.map(dp =>
        `<option value="${escapeHtml(dp.id)}">${escapeHtml(dp.networkId)} · ${escapeHtml(dp.name)}</option>`
      ).join('');
  }

  function syncFaultStart(dp) {
    if (!dp) return;
    ui.faultStartSelect.value = dp.id;
    ui.faultSelectedStart.textContent = `${dp.networkId} · ${dp.name}`;
  }

  function clearFaultLocator(clearForm = false) {
    if (state.faultMarker) {
      state.faultMarker.remove();
      state.faultMarker = null;
    }
    if (state.faultSegmentLayer) {
      state.faultSegmentLayer.remove();
      state.faultSegmentLayer = null;
    }
    state.faultGps = null;
    ui.faultResult.classList.add('hidden');
    ui.faultStatus.textContent = 'Ready';
    ui.faultStatus.classList.remove('active');
    if (clearForm) ui.faultDistanceInput.value = '';
  }

  function routePrefixAtDistance(latlngs, metric, target) {
    const points = [latlngs[0]];
    let acc = 0;

    for (let i = 0; i < metric.segs.length; i++) {
      const distance = metric.segs[i];
      if (acc + distance >= target) {
        points.push(pointAtDistance(latlngs, metric, target));
        break;
      }
      points.push(latlngs[i + 1]);
      acc += distance;
    }
    return points;
  }

  function setFaultError(message) {
    ui.faultStatus.textContent = 'Check input';
    ui.faultStatus.classList.remove('active');
    ui.mapStatus.textContent = message;
    ui.faultResult.classList.add('hidden');
  }

  function dpById(id) {
    return state.allDps.find(dp => dp.id === id) || null;
  }

  function locateOtdrFault() {
    const start = dpById(ui.faultStartSelect.value);
    const distanceM = Number(ui.faultDistanceInput.value);

    if (!start) return setFaultError('Select a start FDP/DP.');
    if (!Number.isFinite(distanceM) || distanceM <= 0) {
      return setFaultError('Enter a valid OTDR fault distance in meter.');
    }

    const network = state.networks.get(start.networkId);
    if (!network?.targetFdc) return setFaultError('FDC for this FDP/DP is not registered.');

    selectAndTrace(start, false);
    const route = state.activeRoute;
    if (!route) return setFaultError('No registered fiber route found from this FDP/DP to FDC.');

    if (distanceM > route.distance + 1) {
      return setFaultError(`OTDR distance ${distanceM.toFixed(0)} m exceeds registered route ${route.distance.toFixed(0)} m to FDC.`);
    }

    clearFaultLocator(false);

    const metric = routeMetric(route.latlngs);
    const targetOnMap = metric.total * Math.min(1, distanceM / route.distance);
    const point = pointAtDistance(route.latlngs, metric, targetOnMap);
    const prefix = routePrefixAtDistance(route.latlngs, metric, targetOnMap);

    state.faultSegmentLayer = L.polyline(prefix, {
      color:'#dc2626',
      weight:6,
      opacity:.9,
      dashArray:'10 7',
      lineCap:'round',
      lineJoin:'round',
      interactive:false
    }).addTo(map);
    state.faultSegmentLayer.bringToFront();

    state.faultMarker = L.marker(point, {
      icon:faultIcon,
      zIndexOffset:2600,
      riseOnHover:true
    }).addTo(map);

    state.faultMarker.bindTooltip(
      `Suspected Cut • ${Math.round(distanceM)} m from ${start.name} · ${network.id}`,
      { permanent:true, direction:'top', offset:[0,-18], className:'fault-label', opacity:1 }
    ).openTooltip();

    state.faultGps = { lat:point.lat, lng:point.lng };
    const balance = Math.max(0, route.distance - distanceM);

    ui.faultGps.textContent = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
    ui.faultFromStart.textContent = `${Math.round(distanceM)} m`;
    ui.faultBalance.textContent = formatKm(balance);
    ui.faultResult.classList.remove('hidden');
    ui.faultStatus.textContent = 'Located';
    ui.faultStatus.classList.add('active');
    ui.mapStatus.textContent = `Suspected cut • ${Math.round(distanceM)} m from ${start.name} · ${network.id} • GPS ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;

    map.setView(point, Math.max(map.getZoom(), 18), { animate:true });

    if (window.innerWidth <= 760) {
      ui.mobileTraceNode.textContent = `⚡ Suspected Cut • ${start.name} · ${network.id}`;
      ui.mobileTraceDistance.textContent = `${Math.round(distanceM)} m • ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
      closeMobileSheet();
    }
  }

  function searchItems(query) {
    const q = String(query || '').trim().toUpperCase();
    if (!q) return [];

    const dps = state.allDps.filter(dp =>
      dp.name.toUpperCase().includes(q) ||
      `${dp.networkId} ${dp.name}`.toUpperCase().includes(q)
    );

    const targetFdcs = [...state.networks.values()]
      .map(network => network.targetFdc)
      .filter(Boolean)
      .filter(fdc => fdc.name.toUpperCase().includes(q));

    return [...dps, ...targetFdcs].slice(0, 14);
  }

  function renderSearchResults() {
    const items = searchItems(ui.searchInput.value);
    if (!items.length) {
      ui.searchResults.classList.add('hidden');
      ui.searchResults.innerHTML = '';
      return;
    }

    ui.searchResults.innerHTML = items.map(item => {
      const type = labelTypeName(item.name);
      const network = item.networkId || [...state.networks.values()].find(n => n.targetFdc?.id === item.id)?.id || '';
      return `<button type="button" data-id="${escapeHtml(item.id)}" data-type="${type || ''}">
        <span>${escapeHtml(item.name)}</span>
        <small>${type === 'dp' ? escapeHtml(network) : 'FDC'}</small>
      </button>`;
    }).join('');

    ui.searchResults.classList.remove('hidden');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    }[c]));
  }

  function setMobileNavActive(button) {
    [ui.mobileDashboardBtn, ui.mobileFaultBtn, ui.mobileDetailsBtn].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn === button);
    });
  }

  function closeMobileSheet() {
    ui.detailsPanel.classList.remove('open');
    setMobileNavActive(ui.mobileDashboardBtn);
    setTimeout(() => map.invalidateSize({ animate:false }), 250);
  }

  function openMobileSheet(mode = 'details') {
    if (window.innerWidth > 760) return;
    ui.detailsPanel.classList.add('open');

    if (mode === 'fault') {
      setMobileNavActive(ui.mobileFaultBtn);
      ui.mobileSheetSubtitle.textContent = 'OTDR fault locator';
      requestAnimationFrame(() => ui.otdrFaultCard?.scrollIntoView({ behavior:'smooth', block:'start' }));
    } else {
      setMobileNavActive(ui.mobileDetailsBtn);
      ui.mobileSheetSubtitle.textContent = 'Trace details & playback';
      ui.detailsPanel.scrollTo({ top:0, behavior:'smooth' });
    }
  }

  function traceFromSearch() {
    if (state.selectedSearchDp && ui.searchInput.value.trim().toUpperCase() === state.selectedSearchDp.name.toUpperCase()) {
      selectAndTrace(state.selectedSearchDp, false);
      return;
    }

    const q = ui.searchInput.value.trim().toUpperCase();
    const exact = state.allDps.filter(dp => dp.name.toUpperCase() === q);

    if (exact.length === 1) {
      selectAndTrace(exact[0], false);
    } else if (exact.length > 1) {
      renderSearchResults();
      showError(`${q} exists in multiple FDC routes. Select the required FDC result.`);
    } else {
      const partial = state.allDps.filter(dp => dp.name.toUpperCase().includes(q));
      if (partial.length === 1) selectAndTrace(partial[0], false);
      else {
        renderSearchResults();
        showError('Select a DP/FDP from search results.');
      }
    }
  }

  function bindUI() {
    ui.searchInput.addEventListener('input', () => {
      state.selectedSearchDp = null;
      renderSearchResults();
    });

    ui.searchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        traceFromSearch();
      }
    });

    ui.searchResults.addEventListener('click', event => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;

      const dp = dpById(button.dataset.id);
      if (dp) {
        state.selectedSearchDp = dp;
        ui.searchInput.value = dp.name;
        ui.searchResults.classList.add('hidden');
        selectAndTrace(dp, false);
        return;
      }

      const fdc = state.allFdcs.find(item => item.id === button.dataset.id);
      if (fdc) {
        const network = state.networks.get(fdc.networkId);
        if (network?.targetFdc?.id === fdc.id) {
          setFdcView(network.id, { fit:true, clearTrace:true });
        }
        const [lng, lat] = toLngLat(fdc.xy);
        map.setView([lat,lng], 18, { animate:true });
        ui.searchInput.value = fdc.name;
        ui.searchResults.classList.add('hidden');
      }
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.search-box')) ui.searchResults.classList.add('hidden');
    });

    ui.fdcViewSelect.addEventListener('change', () => {
      setFdcView(ui.fdcViewSelect.value, { fit:true, clearTrace:true });
    });

    ui.traceBtn.addEventListener('click', traceFromSearch);
    ui.playBtn.addEventListener('click', playTrace);
    ui.mobilePlayBtn.addEventListener('click', playTrace);
    ui.resetBtn.addEventListener('click', resetTrace);
    ui.mobileTraceInfo.addEventListener('click', () => openMobileSheet('details'));

    ui.faultStartSelect.addEventListener('change', () => {
      const dp = dpById(ui.faultStartSelect.value);
      ui.faultSelectedStart.textContent = dp ? `${dp.networkId} · ${dp.name}` : '—';
      if (dp) {
        const network = state.networks.get(dp.networkId);
        const route = findRoute(dp, network);
        if (route) ui.faultStatus.textContent = `${Math.round(route.distance)} m to ${network.id} FDC`;
      } else {
        ui.faultStatus.textContent = 'Ready';
      }
    });

    ui.locateFaultBtn.addEventListener('click', locateOtdrFault);
    ui.faultDistanceInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        locateOtdrFault();
      }
    });

    ui.faultGoogleMapsBtn.addEventListener('click', () => {
      if (!state.faultGps) return;
      const { lat, lng } = state.faultGps;
      window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener');
    });

    ui.speedControl.addEventListener('click', event => {
      const button = event.target.closest('button[data-speed]');
      if (!button) return;
      [...ui.speedControl.querySelectorAll('button')].forEach(x => x.classList.toggle('active', x === button));
      state.speed = button.dataset.speed;
      if (state.playing) {
        stopAnimation(false);
        playTrace();
      }
    });

    document.querySelector('.map-layer-toggle').addEventListener('click', event => {
      const button = event.target.closest('button[data-layer]');
      if (!button) return;
      const next = button.dataset.layer;
      if (next === state.activeBaseLayer) return;

      map.removeLayer(state.baseLayers[state.activeBaseLayer]);
      state.baseLayers[next].addTo(map);
      state.baseLayers[next].bringToBack();
      state.activeBaseLayer = next;
      document.querySelectorAll('.map-layer-toggle button').forEach(x => x.classList.toggle('active', x === button));
    });

    ui.mobileDetailsBtn.addEventListener('click', () => {
      if (ui.detailsPanel.classList.contains('open') && ui.mobileDetailsBtn.classList.contains('active')) closeMobileSheet();
      else openMobileSheet('details');
    });
    ui.mobileDashboardBtn.addEventListener('click', closeMobileSheet);
    ui.mobileFaultBtn.addEventListener('click', () => openMobileSheet('fault'));
    ui.mobileSheetClose.addEventListener('click', closeMobileSheet);
  }

  async function loadNetwork(config) {
    const parts = await Promise.all(config.dataUrls.map(async url => {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache:'no-store' });
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      return response.json();
    }));

    const data = {
      type:'FeatureCollection',
      features:parts.flatMap(part => part.features || [])
    };

    const network = createNetwork(config, data);
    validateNetwork(network);
    return network;
  }

  async function init() {
    bindUI();

    try {
      const networks = await Promise.all(NETWORK_CONFIGS.map(loadNetwork));
      networks.forEach(network => state.networks.set(network.id, network));

      state.allDps = networks.flatMap(network => network.dps);
      state.allFdcs = networks.map(network => network.targetFdc).filter(Boolean);
      state.allFds = networks.flatMap(network => network.fds);
      state.topologyReports = networks.map(network => network.report);

      populateFdcView();
      drawSourceRoutes({ fit:true });
      drawNodes();
      populateFaultStarts();

      const connected = state.topologyReports.reduce((sum, report) => sum + report.connected, 0);
      const total = state.topologyReports.reduce((sum, report) => sum + report.total, 0);

      if (connected === total) {
        ui.networkBadge.innerHTML = `<span class="status-dot"></span>Topology ${connected}/${total} Ready`;
      } else {
        ui.networkBadge.textContent = `Topology ${connected}/${total}`;
      }

      ui.mapStatus.textContent = `${NETWORK_CONFIGS.length} FDC routes • ${total} DP loaded`;
      console.table(state.topologyReports.flatMap(report => report.rows));

      state.fdcView = 'ALL';
      ui.fdcViewSelect.value = 'ALL';
      ui.destination.textContent = '—';
      ui.mapStatus.textContent = `${NETWORK_CONFIGS.length} FDC routes • ${total} DP loaded • Choose FDC View or select a DP`;
    } catch (error) {
      console.error(error);
      ui.networkBadge.textContent = 'Data Error';
      showError('Unable to load fiber topology data.');
    }
  }

  window.addEventListener('resize', () => {
    setTimeout(() => map.invalidateSize({ animate:false }), 120);
    if (window.innerWidth > 760) ui.detailsPanel.classList.remove('open');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  init();
})();
