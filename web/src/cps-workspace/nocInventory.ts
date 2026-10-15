import type { CpsNodeState } from '../services/cps';
import type { CpsWorkspaceCamera, CpsWorkspaceCameraRegistry } from './cameraRegistry';

export type NocInventoryItem =
  | { kind: 'node'; id: 'NODE-04'; state: CpsNodeState }
  | { kind: 'camera'; id: string; camera: CpsWorkspaceCamera };

/** Combines only already-loaded CPS and host-registry data; it never performs I/O. */
export function nocInventoryItems(state: CpsNodeState | null, registry: CpsWorkspaceCameraRegistry): NocInventoryItem[] {
  const items: NocInventoryItem[] = state ? [{ kind: 'node', id: 'NODE-04', state }] : [];
  if (registry.available) items.push(...registry.cameras.map((camera) => ({ kind: 'camera' as const, id: camera.id, camera })));
  return items;
}

export function cameraCaptureLabel(camera: CpsWorkspaceCamera): 'active' | 'error' | 'inactive' {
  return camera.error ? 'error' : camera.active ? 'active' : 'inactive';
}
