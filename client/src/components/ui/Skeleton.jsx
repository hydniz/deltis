// Shimmering placeholder block for loading states. Size and shape come from
// the caller via className (e.g. "h-24 w-full" or "h-4 w-32 rounded-full").
export default function Skeleton({ className = '' }) {
  return <div aria-hidden="true" data-testid="skeleton" className={`skeleton ${className}`} />;
}
