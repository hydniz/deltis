import { AlertCircle } from 'lucide-react';

// Unified error banner for the admin pages.
export default function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 bg-red-900/20 border border-red-900/50 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
      <AlertCircle size={15} className="shrink-0" />
      {message}
    </div>
  );
}
