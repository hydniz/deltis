import { TONE_BUBBLE } from './tones';

// Friendly empty state with serif headline and tinted icon bubble.
export default function EmptyState({ icon: Icon, title, text, action, tone = 'clay', className = '' }) {
  return (
    <div className={`card p-10 sm:p-14 text-center ${className}`}>
      {Icon && (
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${TONE_BUBBLE[tone]}`}>
          <Icon size={22} />
        </div>
      )}
      <p className="display text-xl">{title}</p>
      {text && <p className="text-ink-500 text-sm mt-1.5 max-w-xs mx-auto leading-relaxed">{text}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
