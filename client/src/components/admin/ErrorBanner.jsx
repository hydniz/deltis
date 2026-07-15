import Alert from '../ui/Alert';

// Unified error banner for the admin pages.
export default function ErrorBanner({ message }) {
  if (!message) return null;
  return <Alert tone="error" className="mb-4">{message}</Alert>;
}
