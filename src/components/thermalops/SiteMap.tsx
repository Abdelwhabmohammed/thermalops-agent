'use client';

// Dark Leaflet map with risk-colored sites and quick probe actions.
// Free Esri basemaps: Dark, Satellite, and Hybrid.
// Dark tiles stop at z16, so we cap native zoom there; satellite/hybrid go higher.
// Click anywhere to probe a spot and get weather, wet-bulb, and SVI.
// Optional deep probe uses FortyGuard thermal for one credit.
// State Watch sweeps a state, highlights elevated sentinels, and lets you promote them.

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { fetchStates, probeLocation, registerSite, sweepState } from '@/lib/api';
import type { ProbeResponse, SentinelReading, Site, StateInfo, StateSweepResponse } from '@/lib/types';
import { riskColor, riskBadgeClass } from '@/lib/utils';
import StateWatch from '@/components/thermalops/StateWatch';
import {
  Crosshair,
  Loader2,
  Plus,
  Satellite,
  X,
} from 'lucide-react';

interface SiteMapProps {
  sites: Site[];
  selectedSiteId: number | null;
  onSelectSite: (siteId: number) => void;
  onSiteRegistered?: (siteId: number) => void;
}

// Default center: US lower-48 (rough)
const US_CENTER: [number, number] = [39.0, -98.0];
const US_ZOOM = 4;

const ESRI_DARK_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ESRI_DARK_REF =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_IMAGERY_REF =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

type ProbeState =
  | { phase: 'idle' }
  | { phase: 'pin'; lat: number; lng: number }
  | { phase: 'instant'; lat: number; lng: number; result: ProbeResponse }
  | { phase: 'deep'; lat: number; lng: number; result: ProbeResponse }
  | { phase: 'registering'; lat: number; lng: number; result: ProbeResponse };

export default function SiteMap({ sites, selectedSiteId, onSelectSite, onSiteRegistered }: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Map instance, markers, and a marker-sync fn live in refs — mutated
  // without re-render. Latest props are mirrored into refs so the sync
  // closure always sees fresh data.
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<Map<number, import('leaflet').Marker>>(new Map());
  const sweepMarkersRef = useRef<Map<string, import('leaflet').Marker>>(new Map());
  const probeMarkerRef = useRef<import('leaflet').Marker | null>(null);
  const syncRef = useRef<(() => void) | null>(null);
  const sitesRef = useRef(sites);
  const selectedRef = useRef(selectedSiteId);
  const onSelectRef = useRef(onSelectSite);
  const fittedKeyRef = useRef<string | null>(null);
  sitesRef.current = sites;
  selectedRef.current = selectedSiteId;
  onSelectRef.current = onSelectSite;

  const [probe, setProbe] = useState<ProbeState>({ phase: 'idle' });
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const probeRef = useRef(probe);
  probeRef.current = probe;

  // -- State Watch ----------------------------------------------------------------
  const [states, setStates] = useState<StateInfo[] | null>(null);
  const [watchCode, setWatchCode] = useState<string | null>(null);
  const [sweep, setSweep] = useState<StateSweepResponse | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepErr, setSweepErr] = useState<string | null>(null);
  const [registeringIds, setRegisteringIds] = useState<Set<string>>(new Set());
  const [focusSentinelId, setFocusSentinelId] = useState<string | null>(null);
  const sweepRef = useRef(sweep);
  sweepRef.current = sweep;
  const lastFlownRef = useRef<string | null>(null);

  // Catalog loads once (cheap db query) — powers the state chips.
  useEffect(() => {
    let cancelled = false;
    fetchStates()
      .then((s) => {
        if (!cancelled) setStates(s);
      })
      .catch(() => {
        /* chips stay hidden; the rest of the map still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Map-pin → row focus highlight auto-clears.
  useEffect(() => {
    if (!focusSentinelId) return;
    const t = setTimeout(() => setFocusSentinelId(null), 2600);
    return () => clearTimeout(t);
  }, [focusSentinelId]);

  const runSweep = async (code: string, fresh = false) => {
    setSweeping(true);
    setSweepErr(null);
    try {
      const res = await sweepState(code, fresh);
      setSweep(res);
      // Fly to the state only when it CHANGES — a refresh shouldn't yank the view.
      if (lastFlownRef.current !== code) {
        lastFlownRef.current = code;
        const map = mapRef.current;
        if (map && res.sentinels.length > 0) {
          const L = await import('leaflet');
          map.flyToBounds(
            L.latLngBounds(
              res.sentinels.map((s) => [s.latitude, s.longitude] as [number, number]),
            ).pad(0.35),
            { duration: 1.1, maxZoom: 11 },
          );
        }
      }
    } catch (e) {
      setSweepErr(String((e as Error).message || e));
    } finally {
      setSweeping(false);
    }
  };

  const pickState = (code: string | null) => {
    setWatchCode(code);
    setSweepErr(null);
    setSweep(null);
    if (code) void runSweep(code);
  };

  const registerSentinel = async (s: SentinelReading) => {
    setSweepErr(null);
    setRegisteringIds((prev) => {
      const n = new Set(prev);
      n.add(s.id);
      return n;
    });
    try {
      const created = await registerSite({
        label: s.label,
        latitude: s.latitude,
        longitude: s.longitude,
        city: s.city,
        state: watchCode ?? undefined,
        site_type: s.site_type,
        crew_size: s.crew_size,
        notes: 'Registered from State Watch sweep',
      });
      // Optimistic flip: sentinel becomes "monitored" immediately; the solid
      // site marker replaces the diamond once the sites SWR refresh lands.
      setSweep((prev) =>
        prev
          ? {
            ...prev,
            sentinels: prev.sentinels.map((x) =>
              x.id === s.id ? { ...x, monitored_site_id: created.site_id } : x,
            ),
            summary: { ...prev.summary, monitored: prev.summary.monitored + 1 },
          }
          : prev,
      );
      onSelectRef.current(created.site_id);
      onSiteRegistered?.(created.site_id);
    } catch (e) {
      setSweepErr(String((e as Error).message || e));
    } finally {
      setRegisteringIds((prev) => {
        const n = new Set(prev);
        n.delete(s.id);
        return n;
      });
    }
  };

  const registerAllElevated = async () => {
    const targets = (sweep?.sentinels ?? []).filter(
      (s) =>
        s.monitored_site_id === null &&
        (s.risk_level === 'ELEVATED' || s.risk_level === 'CRITICAL'),
    );
    // Sequential — each registration runs an eager census lookup + a
    // background heatmap fetch; no need to hammer them in parallel.
    for (const t of targets) {
      await registerSentinel(t);
    }
  };

  const openSentinel = (s: SentinelReading) => {
    mapRef.current?.panTo([s.latitude, s.longitude], { animate: true });
    setFocusSentinelId(s.id);
  };

  const closeProbe = () => {
    setProbe({ phase: 'idle' });
    setProbeErr(null);
    probeMarkerRef.current?.remove();
    probeMarkerRef.current = null;
  };

  // Run the FREE instant probe (auto — costs no credits).
  const runInstant = async (lat: number, lng: number) => {
    setProbeErr(null);
    try {
      const result = await probeLocation(lat, lng, false);
      if (probeRef.current.phase === 'idle') return; // closed mid-flight
      setProbe({ phase: 'instant', lat, lng, result });
    } catch (e) {
      setProbeErr(String((e as Error).message || e));
    }
  };

  // Opt-in deep probe — spends 1 FortyGuard credit on satellite thermal.
  const runDeep = async (lat: number, lng: number) => {
    const prev = probeRef.current;
    const prevResult = 'result' in prev ? prev.result : null;
    if (!prevResult) return;
    setProbeErr(null);
    setProbe({ phase: 'deep', lat, lng, result: prevResult });
    try {
      const result = await probeLocation(lat, lng, true);
      if (probeRef.current.phase === 'idle') return;
      setProbe({ phase: 'instant', lat, lng, result });
    } catch (e) {
      setProbeErr(String((e as Error).message || e));
      setProbe({ phase: 'instant', lat, lng, result: prevResult });
    }
  };

  const registerFromProbe = async (lat: number, lng: number, result: ProbeResponse) => {
    setProbeErr(null);
    setProbe({ phase: 'registering', lat, lng, result });
    try {
      const created = await registerSite({
        label: result.suggested.label,
        latitude: lat,
        longitude: lng,
        city: result.suggested.city ?? undefined,
        state: result.suggested.state ?? undefined,
        crew_size: 10,
        notes: 'Registered from map probe',
      });
      onSelectRef.current(created.site_id);
      onSiteRegistered?.(created.site_id);
      closeProbe();
    } catch (e) {
      setProbeErr(String((e as Error).message || e));
      setProbe({ phase: 'instant', lat, lng, result });
    }
  };

  useEffect(() => {
    let cancelled = false;
    let leaflet: typeof import('leaflet');

    const renderMarkers = () => {
      const map = mapRef.current;
      if (!map || !leaflet) return;
      const currentSites = sitesRef.current;

      markersRef.current.forEach((m) => {
        try { m.remove(); } catch { /* noop */ }
      });
      markersRef.current.clear();

      for (const site of currentSites) {
        const color = riskColor(site.current_risk_level);
        const icon = leaflet.divIcon({
          className: 'thermalops-marker',
          html: `
            <div style="
              width: 18px; height: 18px;
              background: ${color};
              border: 3px solid rgba(255,255,255,0.85);
              border-radius: 50%;
              box-shadow: 0 0 0 4px ${color}33, 0 2px 6px rgba(0,0,0,0.5);
              ${selectedRef.current === site.id ? `transform: scale(1.4);` : ''}
            "></div>
          `,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const marker = leaflet
          .marker([site.latitude, site.longitude], { icon })
          .addTo(map)
          .bindTooltip(
            `<strong>${escapeHtml(site.label)}</strong><br/>` +
            `${site.city ?? ''}, ${site.state ?? ''}<br/>` +
            `Risk: <strong>${site.current_risk_level ?? 'unknown'}</strong><br/>` +
            `Action: ${site.current_action ?? '—'}<br/>` +
            `Temp: ${site.current_temp_c?.toFixed(1) ?? '—'}°C`,
            { direction: 'top', offset: [0, -10] }
          )
          .on('click', () => onSelectRef.current(site.id));
        markersRef.current.set(site.id, marker);
      }

      // -- State Watch sweep pins (diamonds) ----------------------------------
      // Sentinels already covered by a registered site are skipped — their
      // solid marker above is the single source of truth.
      sweepMarkersRef.current.forEach((m) => {
        try { m.remove(); } catch { /* noop */ }
      });
      sweepMarkersRef.current.clear();
      const sweepData = sweepRef.current;
      if (sweepData) {
        for (const s of sweepData.sentinels) {
          if (s.monitored_site_id !== null) continue;
          const color = riskColor(s.risk_level);
          const hot = s.risk_level === 'ELEVATED' || s.risk_level === 'CRITICAL';
          const icon = leaflet.divIcon({
            className: 'thermalops-sweep-pin',
            html: `<div class="sweep-pin${hot ? ' hot' : ''}" style="--c:${color}"><div class="sweep-ring"></div><div class="sweep-diamond"></div></div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          const sweepMarker = leaflet
            .marker([s.latitude, s.longitude], { icon, zIndexOffset: 500 })
            .addTo(map)
            .bindTooltip(
              `<strong>${escapeHtml(s.label)}</strong><br/>` +
              `${escapeHtml(s.city)} · sweep ${s.risk_level ?? 'unknown'}<br/>` +
              `${s.temp_c?.toFixed(1) ?? '—'}°C · WB ${s.wet_bulb_c?.toFixed(1) ?? '—'}°C · ${s.crew_size} crew` +
              (s.error ? `<br/><span style="color:#fbbf24">${escapeHtml(s.error)}</span>` : ''),
              { direction: 'top', offset: [0, -12] },
            )
            .on('click', () => setFocusSentinelId(s.id));
          sweepMarkersRef.current.set(s.id, sweepMarker);
        }
      }

      // Fit only when the set of sites changes (new site registered) —
      // NOT on every SWR refresh, which would yank the user's zoom. While a
      // State Watch sweep is active the view stays pinned to the state.
      const key = currentSites.map((s) => s.id).join(',');
      if (currentSites.length > 0 && key !== fittedKeyRef.current && !sweepRef.current) {
        fittedKeyRef.current = key;
        const bounds = leaflet.latLngBounds(
          currentSites.map(s => [s.latitude, s.longitude] as [number, number]),
        );
        map.fitBounds(bounds.pad(0.2), { animate: true });
      }
    };

    (async () => {
      if (!containerRef.current || mapRef.current) return;
      leaflet = await import('leaflet');
      if (cancelled || !containerRef.current) return;

      const map = leaflet.map(containerRef.current, {
        center: US_CENTER,
        zoom: US_ZOOM,
        maxZoom: 19,
        minZoom: 3,
        scrollWheelZoom: true,
        zoomControl: false, // added at topright below — top-left is State Watch turf
        attributionControl: true,
      });
      // Zoom + layers stacked at top-right (top-left hosts the State Watch panel).
      leaflet.control.zoom({ position: 'topright' }).addTo(map);

      // -- Basemaps (free Esri, no key) --------------------------------------
      const dark = leaflet.layerGroup([
        leaflet.tileLayer(ESRI_DARK_BASE, {
          maxNativeZoom: 16, // service stops at z16 — upscale beyond
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        }),
        leaflet.tileLayer(ESRI_DARK_REF, { maxNativeZoom: 16, maxZoom: 19 }),
      ]);
      const satellite = leaflet.tileLayer(ESRI_IMAGERY, {
        maxNativeZoom: 19,
        maxZoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      });
      const hybrid = leaflet.layerGroup([
        satellite,
        leaflet.tileLayer(ESRI_IMAGERY_REF, { maxNativeZoom: 19, maxZoom: 19 }),
      ]);

      dark.addTo(map); // default
      leaflet.control
        .layers(
          { Dark: dark, Satellite: satellite, Hybrid: hybrid },
          {},
          { position: 'topright', collapsed: true },
        )
        .addTo(map);

      // -- Click-to-probe ------------------------------------------------------
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        // Place / move the probe pin.
        const icon = leaflet.divIcon({
          className: 'thermalops-probe-pin',
          html: `<div class="probe-ring"></div><div class="probe-cross">+</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
        if (probeMarkerRef.current) {
          probeMarkerRef.current.setLatLng([lat, lng]);
        } else {
          probeMarkerRef.current = leaflet
            .marker([lat, lng], { icon, zIndexOffset: 1000, interactive: false })
            .addTo(map);
        }
        setProbeErr(null);
        setProbe({ phase: 'pin', lat, lng });
        // Auto-run the free instant probe (zero credits, ~1s).
        void runInstant(lat, lng);
      });

      mapRef.current = map;
      syncRef.current = renderMarkers;
      renderMarkers(); // initial render
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
      sweepMarkersRef.current.clear();
      probeMarkerRef.current = null;
      syncRef.current = null;
    };

  }, []);

  // Sync markers when sites/selection/sweep change
  useEffect(() => {
    syncRef.current?.();
  }, [sites, selectedSiteId, sweep]);

  const pinLat = probe.phase !== 'idle' ? probe.lat : null;
  const pinLng = probe.phase !== 'idle' ? probe.lng : null;
  const result = probe.phase === 'instant' || probe.phase === 'deep' || probe.phase === 'registering'
    ? probe.result
    : null;
  const inst = result?.instant ?? null;
  const deep = result?.deep ?? null;

  return (
    <div className="relative h-full w-full min-h-[400px]">
      <style dangerouslySetInnerHTML={{ __html: PROBE_CSS }} />
      <div
        ref={containerRef}
        className="h-full w-full leaflet-clickable-cursor"
        role="application"
        aria-label="Site risk map — click to scout a location"
      />

      {/* Hint chip */}
      {probe.phase === 'idle' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/85 backdrop-blur border border-slate-700/60 rounded-full px-3 py-1.5 text-[10px] font-mono text-slate-300 flex items-center gap-1.5 pointer-events-none">
          <Crosshair className="w-3 h-3 text-orange-400" aria-hidden />
          click the map to scout any location
        </div>
      )}

      {/* State Watch — regional sentinel sweep panel */}
      <StateWatch
        states={states}
        activeCode={watchCode}
        sweep={sweep}
        sweeping={sweeping}
        error={sweepErr}
        focusSentinelId={focusSentinelId}
        registeringIds={registeringIds}
        onPickState={pickState}
        onRefresh={() => {
          if (watchCode) void runSweep(watchCode, true);
        }}
        onRegisterSentinel={(s) => void registerSentinel(s)}
        onRegisterAllElevated={() => void registerAllElevated()}
        onOpenSentinel={openSentinel}
        onSelectSite={(id) => onSelectRef.current(id)}
      />

      {/* Probe card */}
      {probe.phase !== 'idle' && pinLat !== null && pinLng !== null && (
        <div className="absolute bottom-3 right-3 z-[1100] w-[290px] max-h-[75%] overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-900/95 backdrop-blur shadow-xl">
          {/* Header */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700/60 sticky top-0 bg-slate-900/95">
            <Crosshair className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" aria-hidden />
            <span className="text-xs font-semibold text-slate-100">Scout location</span>
            <span className="text-[9px] font-mono text-slate-500">
              {pinLat.toFixed(4)}, {pinLng.toFixed(4)}
            </span>
            <button
              onClick={closeProbe}
              className="ml-auto text-slate-500 hover:text-slate-200 transition-colors"
              aria-label="Close probe"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>

          <div className="px-3 py-2.5 space-y-2.5">
            {probeErr && (
              <div className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5">
                {probeErr}
              </div>
            )}

            {/* Instant (free) reading */}
            {probe.phase === 'pin' && !probeErr && (
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                pulling free instant conditions…
              </div>
            )}
            {inst && (
              <>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${riskBadgeClass(inst.risk_level)}`}
                  >
                    {inst.risk_level}
                  </span>
                  <span className="text-[9px] text-slate-500">
                    {inst.tier.toLowerCase()} wet-bulb tier · score {inst.composite_score}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Metric label="Air temp" value={`${inst.temp_c.toFixed(1)}°C`} />
                  <Metric
                    label="Wet-bulb (est.)"
                    value={inst.wet_bulb_c !== null ? `${inst.wet_bulb_c.toFixed(1)}°C` : '—'}
                    title="Stull (2011) estimate from temp + humidity — switches to FortyGuard env_params on registration"
                  />
                  <Metric label="AQI" value={inst.aqi !== null ? inst.aqi.toFixed(0) : '—'} />
                  <Metric
                    label="SVI"
                    value={
                      result?.svi?.rplThemes != null
                        ? ordinalPct(Math.round(result.svi.rplThemes * 100))
                        : '—'
                    }
                    title="CDC Social Vulnerability percentile of this census tract"
                  />
                </div>
                {result?.svi?.tract && (
                  <div className="text-[9px] text-slate-500 leading-snug">
                    {result.svi.county ? `${result.svi.county}, ` : ''}
                    {result.svi.stateCode ?? ''} · {result.svi.tract}
                  </div>
                )}
                <div className="text-[9px] text-slate-600 leading-snug">
                  Free scout via {inst.source} + census SVI — zero FortyGuard credits.
                </div>
              </>
            )}

            {/* Deep probe result */}
            {deep && !deep.error && (
              <div className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Satellite className="w-3 h-3 text-sky-400" aria-hidden />
                  <span className="text-[9px] font-semibold text-sky-300">FortyGuard satellite thermal</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-200 font-mono">
                  surface {deep.temp_c !== null ? `${deep.temp_c.toFixed(1)}°C` : 'no tile data'}
                </div>
                <div className="text-[9px] text-slate-500 leading-snug">
                  satellite-derived land-surface temp for the 200 m AOI around this pin
                </div>
              </div>
            )}
            {deep?.error && (
              <div className="text-[9px] text-amber-300/90 leading-snug">
                deep probe failed: {deep.error}
              </div>
            )}

            {/* Actions */}
            {(probe.phase === 'instant') && (
              <div className="flex flex-col gap-1.5 pt-0.5">
                {(!deep || deep.error) && (
                  <button
                    onClick={() => void runDeep(pinLat, pinLng)}
                    className="w-full text-[10px] px-2 py-1.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-colors flex items-center justify-center gap-1.5"
                    title="Runs FortyGuard /v1/heatmap on a 200m AOI at this pin (spends 1 credit)"
                  >
                    <Satellite className="w-3 h-3" aria-hidden />
                    Deep probe — FortyGuard surface °C (1 credit)
                  </button>
                )}
                <button
                  onClick={() => void registerFromProbe(pinLat, pinLng, result!)}
                  className="w-full text-[10px] px-2 py-1.5 rounded border border-orange-500/50 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25 transition-colors flex items-center justify-center gap-1.5 font-semibold"
                  title="Registers this location as a monitored site — starts the full FortyGuard pipeline (heatmap, env_params, tiered agent)"
                >
                  <Plus className="w-3 h-3" aria-hidden />
                  Register &amp; monitor this site
                </button>
              </div>
            )}

            {probe.phase === 'deep' && (
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                FortyGuard measuring the surface… (~10–30 s)
              </div>
            )}
            {probe.phase === 'registering' && (
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                registering — first FortyGuard reading on its way…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ordinalPct(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded bg-slate-800/60 border border-slate-700/40 px-2 py-1.5" title={title}>
      <div className="text-[8px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-[11px] font-mono text-slate-100">{value}</div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Dark-theme overrides for the Leaflet layer switcher + probe pin animation.
const PROBE_CSS = `
.leaflet-clickable-cursor .leaflet-grab { cursor: crosshair; }
.leaflet-control-layers {
  background: rgba(15, 23, 42, 0.92) !important;
  color: #e2e8f0 !important;
  border: 1px solid rgba(51, 65, 85, 0.8) !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
}
.leaflet-control-layers-toggle { background-color: rgba(15, 23, 42, 0.9); border-radius: 6px; }
.leaflet-control-layers-expanded {
  padding: 10px 12px !important;
  font-size: 11px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.leaflet-control-layers-list label { color: #cbd5e1 !important; margin: 3px 0; cursor: pointer; }
.leaflet-control-layers-selector { accent-color: #f97316; margin-right: 6px; }
.leaflet-bar a {
  background: rgba(15, 23, 42, 0.92) !important;
  color: #e2e8f0 !important;
  border-color: rgba(51, 65, 85, 0.8) !important;
}
.leaflet-control-attribution {
  background: rgba(15, 23, 42, 0.7) !important;
  color: #64748b !important;
  font-size: 9px !important;
}
.leaflet-control-attribution a { color: #94a3b8 !important; }
.thermalops-probe-pin { position: relative; }
.probe-ring {
  position: absolute; inset: 0;
  border: 2px solid rgba(249, 115, 22, 0.9);
  border-radius: 50%;
  animation: probe-pulse 1.6s ease-out infinite;
}
.probe-cross {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fdba74; font-weight: 700; font-size: 20px; line-height: 1;
  text-shadow: 0 0 6px rgba(0,0,0,0.9);
  font-family: ui-monospace, monospace;
}
@keyframes probe-pulse {
  0% { transform: scale(0.55); opacity: 1; }
  100% { transform: scale(1.6); opacity: 0; }
}
/* State Watch sweep pins — small diamonds; elevated/critical get a pulse ring */
.thermalops-sweep-pin { background: transparent; border: none; }
.sweep-pin { position: relative; width: 26px; height: 26px; }
.sweep-diamond {
  position: absolute; left: 7px; top: 7px;
  width: 12px; height: 12px;
  background: var(--c);
  border: 2px solid rgba(255,255,255,0.85);
  transform: rotate(45deg);
  box-shadow: 0 1px 4px rgba(0,0,0,0.6);
}
.sweep-ring {
  position: absolute; inset: 2px;
  border: 2px solid var(--c);
  border-radius: 50%;
  opacity: 0;
}
.sweep-pin.hot .sweep-ring { animation: sweep-pulse 1.6s ease-out infinite; }
@keyframes sweep-pulse {
  0% { transform: scale(0.5); opacity: 0.9; }
  100% { transform: scale(1.5); opacity: 0; }
}
`;
