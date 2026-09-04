import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { LogOut, ShieldAlert, Building2 } from 'lucide-react';
import { setQueryClient } from './services/api';

import { useAuth, useSessionMonitor } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';

// Pages
import LoginPage from './pages/LoginPage';
import TenderList from './pages/TenderList';
import TenderDetail from './pages/TenderDetail';
import CreateTender from './pages/CreateTender';
import VerifyPage from './pages/VerifyPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import AdminDashboard from './pages/AdminDashboard';
import AuditLog from './pages/AuditLog';
import OfficialManagement from './pages/OfficialManagement';

// Initialize React Query
const queryClient = new QueryClient();
setQueryClient(queryClient);

// Layout wrapper including Navbar and Session Warning
function Layout() {
  const { officer, logout, isLoggingOut, isAuthenticated } = useAuth();
  const { showWarning, remainingTime, extendSession, isExtending } = useSessionMonitor(isAuthenticated);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Navbar */}
      <Navbar />

      {/* Persistent Session Timeout Warning */}
      {showWarning && (
        <div className="bg-amber-100 border-b border-amber-200 px-4 py-3 sticky top-16 z-30 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            <p className="text-sm font-medium text-amber-900">
              Your session will expire in <span className="font-bold text-red-600">{remainingTime}</span> seconds due to inactivity.
            </p>
          </div>
          <button 
            onClick={extendSession} 
            disabled={isExtending}
            className="px-4 py-1.5 bg-navy hover:bg-navy-light text-white text-sm font-medium rounded shadow transition-colors disabled:opacity-70"
          >
            {isExtending ? 'Extending...' : 'Extend Session'}
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Toaster position="top-right" toastOptions={{ className: 'text-sm font-medium' }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          
          {/* Protected Layout */}
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/tenders" replace />} />
            
            <Route 
              path="/tenders" 
              element={
                <ProtectedRoute>
                  <TenderList />
                </ProtectedRoute>
              } 
            />
            
            <Route 
              path="/tenders/new" 
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'OFFICER']}>
                  <CreateTender />
                </ProtectedRoute>
              } 
            />
            
            <Route 
              path="/tenders/:id" 
              element={
                <ProtectedRoute>
                  <TenderDetail />
                </ProtectedRoute>
              } 
            />

            {/* Admin Routes */}
            <Route 
              path="/admin" 
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminDashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin/audit" 
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AuditLog />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin/officials" 
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <OfficialManagement />
                </ProtectedRoute>
              } 
            />
          </Route>
          
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}
