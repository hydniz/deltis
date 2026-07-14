// Shared header for all admin pages: amber icon accent, title, description
// and an optional action slot on the right – keeps the admin area visually
// consistent with the amber "Administration" section in the sidebar.
export default function AdminPageHeader({ icon: Icon, title, description, action }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          {Icon && <Icon size={20} className="text-amber-400" />}
          {title}
        </h1>
        {description && (
          <p className="text-slate-500 text-sm mt-1">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
