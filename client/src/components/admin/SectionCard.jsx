// Card with the uppercase section header used across the admin pages.
export default function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/40">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          {Icon && <Icon size={13} />}
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
