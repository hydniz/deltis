// Shared header for all admin pages: ocher icon accent, serif title,
// description and an optional action slot on the right.
export default function AdminPageHeader({ icon: Icon, title, description, action }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="display text-2xl sm:text-3xl flex items-center gap-2.5">
          {Icon && <Icon size={20} className="text-ocher-500 flex-shrink-0" />}
          {title}
        </h1>
        {description && (
          <p className="text-ink-500 text-sm mt-1.5">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
