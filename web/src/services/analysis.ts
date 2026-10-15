import type { EventCategory } from '../model/types';

/**
 * Video analysis boundary. No computer-vision service is connected in this
 * prototype, so `simulatedAnalysisService` returns labeled fixture results.
 * Replace it with an implementation that calls the real analysis API.
 */
export interface RecordingDetection { category: EventCategory; offsetSec: number }
export interface RecordingAnalysis {
  mode: 'simulated' | 'service';
  detections: RecordingDetection[];
  /** why there are no detections, when applicable */
  note?: 'no_fixture';
}
export interface AnalysisService {
  analyzeRecording(file: File): Promise<RecordingAnalysis>;
}

const FIXTURES: Record<string, RecordingDetection> = {
  'fall.mp4': { category: 'fall', offsetSec: 4 },
  'smoke.mp4': { category: 'fire_smoke', offsetSec: 6 },
  'crowd.mp4': { category: 'crowding', offsetSec: 3 },
  'obstruction.mp4': { category: 'obstruction', offsetSec: 5 },
};

export const simulatedAnalysisService: AnalysisService = {
  analyzeRecording(file) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const fx = FIXTURES[file.name.toLowerCase()];
        resolve(fx ? { mode: 'simulated', detections: [fx] } : { mode: 'simulated', detections: [], note: 'no_fixture' });
      }, 2200);
    });
  },
};

export const SUPPORTED_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
export function isSupportedVideo(f: File): boolean {
  if (SUPPORTED_VIDEO.includes(f.type)) return true;
  return /\.(mp4|webm|mov|ogv)$/i.test(f.name) && (f.type === '' || f.type.startsWith('video/'));
}

export type CameraAccessError = 'denied' | 'not_found' | 'unavailable';
export async function requestDeviceCamera(): Promise<MediaStream> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md || !md.getUserMedia) throw 'unavailable' as CameraAccessError;
  try {
    return await md.getUserMedia({ video: true, audio: false });
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw 'denied' as CameraAccessError;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw 'not_found' as CameraAccessError;
    throw 'unavailable' as CameraAccessError;
  }
}
