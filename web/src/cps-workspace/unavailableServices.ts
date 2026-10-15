/** Explicit placeholder for the monitor-only HVAC service not integrated into teammate main. */
export type CpsWorkspaceUnavailable = { available: false; reason: string };
export const HVAC_RECOMMENDATION_UNAVAILABLE: CpsWorkspaceUnavailable = { available: false, reason: 'Monitor-only HVAC recommendation service is not integrated in this workspace.' };
