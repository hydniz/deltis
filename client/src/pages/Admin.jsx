// Admin.jsx is the admin-area root.
// Sub-pages (AdminUsers, AdminConfig, AdminUpdates) are rendered by App.jsx
// via nested routes under /admin/*. This file re-exports a default so that
// any accidental direct import still resolves cleanly.
export { default } from './AdminUsers';
