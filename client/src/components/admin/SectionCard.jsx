// Card with the uppercase section header used across the admin pages.
// `help` takes a <HelpTip> and is pinned to the right of the header.
export default function SectionCard({ icon: Icon, title, help, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b hairline bg-paper-50 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold text-ink-500 uppercase tracking-[0.09em] flex items-center gap-2">
          {Icon && <Icon size={13} />}
          {title}
        </h2>
        {help}
      </div>
      {children}
    </div>
  );
}
