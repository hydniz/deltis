import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Activities from './pages/Activities';
import Planner from './pages/Planner';
import Habits from './pages/Habits';
import Weight from './pages/Weight';
import Goals from './pages/Goals';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import AdminSetup from './pages/AdminSetup';
import api from './utils/api';

function Spinner() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? children : <Navigate to="/login" replace />;
}

// Eigenständige Route für /admin – prüft selbst Auth und Setup-Status
function AdminPage() {
  const { user, loading } = useAuth();
  const [setupNeeded, setSetupNeeded] = useState(null);

  useEffect(() => {
    if (!loading && !user?.isAdmin) {
      api.get('/admin/setup-status')
        .then(res => setSetupNeeded(res.data.setupNeeded))
        .catch(() => setSetupNeeded(false));
    }
  }, [loading, user]);

  if (loading || (!user?.isAdmin && setupNeeded === null)) return <Spinner />;
  if (user?.isAdmin) {
    return (
      <Layout>
        <Admin />
      </Layout>
    );
  }
  if (setupNeeded) return <Navigate to="/admin/setup" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/setup" element={<AdminSetup />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="activities" element={<Activities />} />
            <Route path="planner" element={<Planner />} />
            <Route path="habits" element={<Habits />} />
            <Route path="weight" element={<Weight />} />
            <Route path="goals" element={<Goals />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
