// A subtle labelled rule marking where a new week starts in a date-sorted list.
export default function WeekDivider({ label }) {
  return (
    <div className="flex items-center gap-3 pt-3 pb-1 first:pt-0" aria-hidden="true">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 whitespace-nowrap">
        {label}
      </span>
      <span className="flex-1 h-px bg-ink-900/[.07]" />
    </div>
  );
}
