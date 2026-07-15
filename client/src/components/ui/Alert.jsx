import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

// Inline message banner. Tones: error | warning | success | info.
const TONES = {
  error: {
    icon: AlertCircle,
    cls: 'bg-red-50 border-red-200 text-red-800',
    iconCls: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    cls: 'bg-amber-50 border-amber-200 text-amber-900',
    iconCls: 'text-amber-500',
  },
  success: {
    icon: CheckCircle2,
    cls: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    iconCls: 'text-emerald-500',
  },
  info: {
    icon: Info,
    cls: 'bg-paper-100 border-paper-200 text-ink-600',
    iconCls: 'text-ink-400',
  },
};

export default function Alert({ tone = 'info', title, children, className = '' }) {
  const { icon: Icon, cls, iconCls } = TONES[tone];
  return (
    <div className={`flex items-start gap-2.5 border rounded-xl px-3.5 py-3 text-sm ${cls} ${className}`}>
      <Icon size={15} className={`flex-shrink-0 mt-0.5 ${iconCls}`} />
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="[&_code]:font-mono [&_code]:text-xs [&_code]:bg-ink-900/[.06] [&_code]:px-1 [&_code]:rounded">{children}</div>}
      </div>
    </div>
  );
}
