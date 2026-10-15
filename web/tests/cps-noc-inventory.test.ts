import { cameraCaptureLabel, nocInventoryItems } from '../src/cps-workspace/nocInventory';
import type { CpsNodeState } from '../src/services/cps';
import type { CpsWorkspaceCamera, CpsWorkspaceCameraRegistry } from '../src/cps-workspace/cameraRegistry';
import { readFileSync } from 'node:fs';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };
const node: CpsNodeState = { node_id: 'NODE-04', status: 'ACTIVE', connection_status: 'OFFLINE', location_id: 'A1-1', last_heartbeat_received_at: '2026-10-13T09:00:00Z', reported_relay_state: null, relay_reported_at: null, network_observation: { reported_ip: null, reported_mac: null, reported_rssi_dbm: null, reported_ssid: null, reported_bssid: null, reported_wifi_channel: null, reported_gateway: null, reported_subnet_mask: null, reported_at: null }, as_of: '2026-10-13T10:00:00Z', readings: [] };
const camera: CpsWorkspaceCamera = { id: 'CAM-1', source: 'stream', active: true, fps: 12, error: '', alerts: [] };
const available: CpsWorkspaceCameraRegistry = { available: true, cameras: [camera] };

ok(nocInventoryItems(node, available).map((item) => item.id).join(',') === 'NODE-04,CAM-1', 'combines validated NODE-04 with registry cameras');
ok(nocInventoryItems(node, { available: false, cameras: null }).length === 1, 'registry unavailable does not become a zero-camera inventory');
ok(nocInventoryItems(null, { available: true, cameras: [] }).length === 0, 'empty available registry remains distinct from unavailable registry');
ok(cameraCaptureLabel(camera) === 'active', 'application capture state is independent of network reachability');
ok(cameraCaptureLabel({ ...camera, active: false, error: 'frame source failed' }) === 'error', 'application errors take precedence over inactive capture');

const workspace = readFileSync(new URL('../src/cps-workspace/CpsWorkspace.tsx', import.meta.url), 'utf8');
ok(workspace.includes("setSelection({ kind: 'node' })") && workspace.includes("setSelection({ kind: 'camera', id: item.id })"), 'inventory selection opens node and camera details');
ok(workspace.includes('role="dialog"') && workspace.includes("event.key === 'Escape'") && workspace.includes('onClose={() => setSelection(null)}'), 'details drawer supports close control and Escape');
ok(workspace.includes("connection_status === 'ONLINE' ? 'fine' : 'warnline'") && workspace.includes('last_heartbeat_received_at'), 'offline node details retain historical receipt context');
ok(workspace.includes('does not prove camera network connectivity') && workspace.includes('Network reachability'), 'camera capture details explicitly separate network reachability');
ok((workspace.match(/const heartbeats = useHeartbeats\(\)/g) ?? []).length === 1 && workspace.includes('heartbeats={heartbeats}'), 'NOC reuses the single workspace heartbeat load');

if (failures) process.exit(1);
