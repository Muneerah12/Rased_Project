import { useStore, useUI } from '../state/store';
import { SUITABLE_TEAMS } from '../model/fixtures';
import { empUnseen } from '../model/selectors';
import type { Incident, TeamId } from '../model/types';
import { TEAMS } from '../model/types';
import { LABELS } from './labels';
import { Icon } from './icons';
import { Chip, Ltr } from './primitives';
import mohLogo from '../assets/moh-logo.png';
import civilDefenseLogo from '../assets/civil-defense-logo.png';

/** Official logos: the medical team belongs to the Ministry of Health; civil defense to the Civil Defense directorate. */
const TEAM_LOGOS: Partial<Record<TeamId, string>> = { medical: mohLogo, civil_defense: civilDefenseLogo };

/** Team identity: logo or icon (when available) plus the team name. */
export function TeamBadge({ team, size = 'md' }: { team: TeamId; size?: 'sm' | 'md' }) {
  const { tl, T } = useUI();
  const logo = TEAM_LOGOS[team];
  const icon = team === 'hvac' ? 'hvac' : team === 'organizers' ? 'idbadge' : null;
  return (
    <span className={`team t-${team} ${size}`}>
      {logo && <img src={logo} alt="" className="team-logo" />}
      {!logo && icon && <Icon name={icon} size={size === 'sm' ? 15 : 18} />}
      {!logo && !icon && <span className="team-nologo" title={T('الشعار الرسمي لم يُزوَّد بعد', 'Official logo not supplied yet')} aria-hidden="true" />}
      <span className="team-n">{tl(LABELS.team[team])}</span>
    </span>
  );
}

/** The four response teams with suitability and availability for one incident. */
export function TeamsOverview({ inc }: { inc: Incident }) {
  const { s } = useStore();
  const { T } = useUI();
  const suitable = SUITABLE_TEAMS[inc.category] ?? [];
  return (
    <ul className="teams-ov">
      {TEAMS.map((team) => {
        const members = s.employees.filter((e) => e.team === team && e.onSite && e.availability !== 'off_duty');
        const avail = members.filter((e) => e.availability === 'available' && !empUnseen(s, e)).length;
        const ok = suitable.includes(team);
        return (
          <li key={team} className={ok ? 'ok' : 'no'}>
            <TeamBadge team={team} />
            {ok ? <Chip tone="ok" icon={<Icon name="check" size={12} />}>{T('مناسب لهذا النوع', 'Suitable for this type')}</Chip>
              : <Chip tone="neutral">{T('غير مناسب لهذا النوع', 'Not suited to this type')}</Chip>}
            <span className="muted small"><Ltr>{avail}</Ltr> {T('متاح', 'available')} / <Ltr>{members.length}</Ltr> {T('في الموقع', 'on site')}</span>
          </li>
        );
      })}
    </ul>
  );
}
