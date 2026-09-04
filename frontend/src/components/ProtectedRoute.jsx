import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AlertCircle, ShieldAlert, Fingerprint } from 'lucide-react';

export default function ProtectedRoute({ children, allowedRoles, requiredLoA }) {
  const { officer, isAuthenticated, isLoading, getLoginUrl, isGettingLoginUrl } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border-4 border-navy border-t-gold rounded-full animate-spin mb-4"></div>
          <p className="text-slate-500 font-medium animate-pulse">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !officer) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(officer.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Check LoA if required
  if (requiredLoA) {
    // Map of LoA levels to integer for comparison (higher is better)
    const loaMap = {
      'LOA_2_OTP': 2,
      'LOA_2_DEMOGRAPHIC': 2,
      'LOA_3_BIOMETRIC': 3
    };
    
    const userLoAValue = loaMap[officer.loa_level] || 0;
    const requiredLoAValue = loaMap[requiredLoA] || 0;
    
    if (userLoAValue < requiredLoAValue) {
      // Step-up authentication required
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-sm border border-amber-200 p-8 text-center">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6">
               <ShieldAlert className="w-8 h-8" />
            </div>
            
            <h2 className="text-2xl font-bold text-navy mb-3">Step-Up Authentication Required</h2>
            <p className="text-slate-600 mb-8">
              You are trying to access a highly sensitive area (e.g., signing a tender). Your current session was authenticated via OTP. You must re-authenticate using your Biometric credentials.
            </p>
            
            <button
              disabled={isGettingLoginUrl}
              onClick={async () => {
                try {
                  const data = await getLoginUrl('biometric');
                  if (data && data.loginUrl) {
                    window.location.href = data.loginUrl; // Explicit hard redirect to OIDC
                  }
                } catch (err) {
                  console.error('Failed to get step-up url', err);
                }
              }}
              className="w-full bg-navy text-white font-semibold py-3 px-4 rounded-lg shadow hover:bg-navy-light flex items-center justify-center gap-2 transition-all disabled:opacity-70"
            >
              <Fingerprint className="w-5 h-5" />
              {isGettingLoginUrl ? 'Initializing...' : 'Upgrade Session via eSignet'}
            </button>
          </div>
        </div>
      );
    }
  }

  return children;
}
