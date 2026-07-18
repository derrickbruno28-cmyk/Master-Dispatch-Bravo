import { useStore } from '../data/store';
import { teamByKey, teamInitials } from '../teams';

/* Morale badge display (Caleb 07/09-10): renders the user's team in the
   topbar gap once one is picked — SELECTION now lives under ☰ Settings, so
   an unpicked user shows nothing here (space saved, no hint chip). */
export default function TeamBadge() {
  const { moraleEnabled, users, currentUser } = useStore();
  const me = users.find((u) => u.id === currentUser.id) ?? currentUser;
  const team = teamByKey(me.team);
  if (!moraleEnabled || !me.moraleOk || !team) return null;

  return (
    <span className="team-badge" title={`${team.name} — change under ☰ Settings`}>
      {me.teamLogoUrl ? (
        <img className="team-logo" src={me.teamLogoUrl} alt="" />
      ) : (
        <span className="team-mono" style={{ background: team.color }}>{teamInitials(team.name)}</span>
      )}
      <span className="team-name" style={{ color: team.color }}>{team.name}</span>
    </span>
  );
}
