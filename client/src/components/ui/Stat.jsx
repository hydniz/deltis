import { Link } from 'react-router-dom';
import { TONE_BUBBLE as TONES } from './tones';

export default function Stat({ icon: Icon, label, value, sub, tone = 'clay', to }) {
  const inner = (
    <div className={`card p-4 sm:p-5 h-full ${to ? 'card-hover' : ''}`}>
      {Icon && (
        <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${TONES[tone]}`}>
          <Icon size={16} />
        </div>
      )}
      <p className="text-[11px] text-ink-400 uppercase tracking-[0.09em] font-semibold">{label}</p>
      <p className="display text-2xl sm:text-3xl mt-1">{value}</p>
      {sub && <p className="text-xs text-ink-400 mt-1">{sub}</p>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}
