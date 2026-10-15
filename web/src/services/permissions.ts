import type { Incident, Role, Section } from '../model/types';

/**
 * Prototype role matrix (approved for this prototype). It only shapes what the
 * UI offers; it is NOT security enforcement. A real backend must re-check every action.
 */
export interface Persona { role: Role; userId: string; name: { ar: string; en: string } }
export const PERSONAS: Record<Role, Persona> = {
  operator: { role: 'operator', userId: 'OP-01', name: { ar: 'سارة الحربي', en: 'Sara Al-Harbi' } },
  analyst: { role: 'analyst', userId: 'SA-02', name: { ar: 'ماجد القحطاني', en: 'Majed Al-Qahtani' } },
  privacy: { role: 'privacy', userId: 'PA-01', name: { ar: 'نوف الشمري', en: 'Nouf Al-Shammari' } },
  access_admin: { role: 'access_admin', userId: 'AA-01', name: { ar: 'تركي الدوسري', en: 'Turki Al-Dosari' } },
  responder: { role: 'responder', userId: 'E014', name: { ar: 'أحمد', en: 'Ahmed' } },
};

const SECTION_ACCESS: Record<Role, Section[]> = {
  operator: ['dashboard', 'cameras', 'incidents', 'employees', 'iot', 'reports'],
  analyst: ['dashboard', 'cameras', 'incidents', 'employees', 'iot', 'reports'],
  privacy: ['dashboard', 'incidents', 'reports'],
  access_admin: ['dashboard', 'incidents', 'employees'],
  responder: ['dashboard', 'incidents'],
};
export const canSee = (role: Role, s: Section) => SECTION_ACCESS[role].includes(s);

export type Capability =
  | 'assign' | 'drone' | 'close' | 'manual_report' | 'run_analysis' | 'view_employees' | 'view_all_incidents' | 'view_devices' | 'view_permissions';
export function can(role: Role, cap: Capability): boolean {
  switch (cap) {
    case 'assign': case 'drone': case 'close': return role === 'operator';
    case 'manual_report': return role !== 'responder';
    case 'run_analysis': return role === 'operator' || role === 'analyst';
    case 'view_employees': return role === 'operator' || role === 'analyst' || role === 'access_admin';
    case 'view_all_incidents': return role !== 'responder';
    case 'view_devices': return role === 'operator' || role === 'analyst';
    /** user-confirmed: permissions, allowed zones and temporary permits */
    case 'view_permissions': return role === 'access_admin' || role === 'operator';
  }
}
/** Responders only see incidents assigned to them. */
export function incidentVisible(role: Role, userId: string, i: Incident): boolean {
  if (role !== 'responder') return true;
  return i.assignment?.employeeId === userId;
}
