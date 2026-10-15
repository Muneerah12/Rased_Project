import type { AiCamera } from '../model/types';

/** Read-only projection of existing host WebSocket state; it performs no request or polling. */
export type CpsWorkspaceCamera = Pick<AiCamera, 'id' | 'source' | 'active' | 'fps' | 'error' | 'alerts'>;
export type CpsWorkspaceCameraRegistry = { available: false; cameras: null } | { available: true; cameras: CpsWorkspaceCamera[] };
export function cameraRegistryFromHost(connected: boolean, cameras: Record<string, AiCamera> | null | undefined): CpsWorkspaceCameraRegistry {
  if (!connected || !cameras) return { available: false, cameras: null };
  return { available: true, cameras: Object.values(cameras).map(({ id, source, active, fps, error, alerts }) => ({ id, source, active, fps, error, alerts })).sort((a, b) => a.id.localeCompare(b.id)) };
}
export function activeApplicationCaptureCount(registry: CpsWorkspaceCameraRegistry): number | null { return registry.available ? registry.cameras.filter((camera) => camera.active).length : null; }
