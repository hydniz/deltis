import { Spinner } from '../ui/Spinner';

// Centered loading spinner for the admin pages.
export default function AdminSpinner() {
  return (
    <div className="flex justify-center py-12">
      <Spinner size="md" />
    </div>
  );
}
