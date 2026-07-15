// Card with the uppercase section header used across the admin pages.
export default function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b hairline bg-paper-50">
        <h2 className="text-[11px] font-semibold text-ink-500 uppercase tracking-[0.09em] flex items-center gap-2">
          {Icon && <Icon size={13} />}
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
