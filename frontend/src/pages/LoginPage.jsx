import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Shield, Lock, CheckCircle2, ChevronRight, Terminal, Loader2 } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../services/api';

export default function LoginPage() {
  const { isAuthenticated, isLoading, getLoginUrl, isGettingLoginUrl } = useAuth();
  const [searchParams] = useSearchParams();
  
  const errorParam = searchParams.get('error');

  // Dev Login State
  const [devRole, setDevRole] = useState('OFFICER');
  const [devLoa, setDevLoa] = useState('LOA_3_BIOMETRIC');
  const [isDevLoggingIn, setIsDevLoggingIn] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-navy">
        <div className="w-12 h-12 border-4 border-white/20 border-t-saffron rounded-full animate-spin"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/tenders" replace />;
  }

  const handleLogin = async (acr) => {
    try {
      const data = await getLoginUrl(acr);
      if (data && data.loginUrl) {
        window.location.href = data.loginUrl;
      }
    } catch (err) {
      console.error('Login initiation failed', err);
    }
  };

  const handleDevLogin = async () => {
    try {
      setIsDevLoggingIn(true);
      const subMap = {
        'ADMIN': 'TEST-SUB-ADMIN-001',
        'OFFICER': 'TEST-SUB-OFFICER-001'
      };
      await axios.post(`${API_BASE}/auth/dev-login`, {
        aadhaar_sub: subMap[devRole],
        role: devRole,
        loa_level: devLoa
      }, { withCredentials: true });
      // Force full page reload to pick up new session cookie
      window.location.replace('/tenders');
    } catch (err) {
      console.error('Dev login failed', err);
      const detail = err.response?.data?.error || err.response?.data?.message || err.message;
      alert(`Login failed: ${detail}\n\nEndpoint: ${API_BASE || '(relative /auth/dev-login)'}`);
    } finally {
      setIsDevLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-navy">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] rounded-full bg-institutional-blue/30 blur-[120px]"></div>
        <div className="absolute top-[40%] -right-[20%] w-[60%] h-[60%] rounded-full bg-saffron/20 blur-[120px]"></div>
        <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-institutional-blue/20 blur-[100px]"></div>
      </div>

      <div className="w-full max-w-5xl px-4 sm:px-6 z-10 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 items-center">
        
        {/* Left Side: Typography & Context */}
        <div className="text-white space-y-6 text-center md:text-left py-8 md:py-0">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md mb-2">
            <Shield className="w-4 h-4 text-saffron" />
            <span className="text-xs font-bold tracking-widest uppercase text-white/90">Official Government Portal</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            Tender Verification <br className="hidden md:block"/>& e-Signing System
          </h1>
          
          <p className="text-lg text-white/70 max-w-lg font-light leading-relaxed mx-auto md:mx-0">
            Secure, transparent, and authoritative platform for the Government of Maharashtra procurement processes.
          </p>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-6 pt-4">
            <div className="flex items-center gap-2 text-white/60 text-sm font-medium">
              <Lock className="w-4 h-4 text-saffron" />
              <span>MOSIP Verified</span>
            </div>
            <div className="flex items-center gap-2 text-white/60 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 text-saffron" />
              <span>W3C VC Standard</span>
            </div>
          </div>
        </div>

        {/* Right Side: Glassmorphism Login Card */}
        <div className="w-full max-w-md mx-auto relative flex flex-col gap-6">
          {/* Main Card Glow */}
          <div className="absolute inset-0 bg-white/5 rounded-3xl blur-xl transform scale-105 pointer-events-none"></div>
          
          {/* Glass Card */}
          <div className="relative bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl rounded-3xl p-8 sm:p-10 overflow-hidden">
            {/* Inner highlight */}
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>

            <div className="relative z-10 text-center mb-10">
              <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Secure Access</h2>
              <p className="text-sm text-white/60">Authenticate via Digital ID (eSignet)</p>
            </div>

            {errorParam && (
              <div className="bg-red-500/20 border border-red-500/50 text-white px-4 py-3 rounded-xl mb-8 backdrop-blur-md">
                <p className="text-sm font-medium flex items-center justify-center gap-2">
                  <Shield className="w-4 h-4 text-red-300" />
                  Auth Failed: {errorParam.replace(/_/g, ' ')}
                </p>
              </div>
            )}

            <div className="space-y-4">
              <button
                onClick={() => handleLogin('mosip')}
                disabled={isGettingLoginUrl}
                className="w-full group relative flex items-center justify-between p-4 bg-white/10 hover:bg-white/20 disabled:opacity-50 border border-white/20 rounded-2xl transition-all duration-300 overflow-hidden shadow-[0_8px_32px_0_rgba(31,38,135,0.1)]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-institutional-blue/0 via-institutional-blue/10 to-saffron/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-saffron/20 flex items-center justify-center border border-saffron/30">
                    <Shield className="w-5 h-5 text-saffron" />
                  </div>
                  <div className="text-left">
                    <span className="block font-bold text-white text-base">Government Official</span>
                    <span className="block text-xs text-white/60 mt-0.5">MOSIP Biometric Auth</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-white/40 group-hover:text-white transition-colors relative z-10 transform group-hover:translate-x-1" />
              </button>

              <button
                onClick={() => handleLogin('google')}
                disabled={isGettingLoginUrl}
                className="w-full group relative flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 rounded-2xl transition-all duration-300"
              >
                <div className="relative flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                    <svg className="w-5 h-5 text-white/80" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="block font-bold text-white text-base">Sandbox Access</span>
                    <span className="block text-xs text-white/60 mt-0.5">Demo authentication</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-white/40 group-hover:text-white transition-colors relative transform group-hover:translate-x-1" />
              </button>
            </div>

            {isGettingLoginUrl && (
              <p className="text-center text-xs font-medium text-white/60 mt-5 animate-pulse">
                Redirecting to Identity Provider...
              </p>
            )}

            <div className="mt-8 pt-6 border-t border-white/10 text-center">
              <p className="text-xs text-white/40">
                Secured by Government of Maharashtra
              </p>
            </div>
          </div>

          {/* Demo / Sandbox Login Section */}
          <div className="relative bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 overflow-hidden shadow-xl">
            <div className="flex items-center gap-2 mb-4 border-b border-white/15 pb-3">
              <Terminal className="w-4 h-4 text-saffron" />
              <h3 className="text-sm font-bold text-white/90">Demo / Evaluator Quick Login</h3>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-white/70">Role</label>
                  <select 
                    value={devRole}
                    onChange={(e) => setDevRole(e.target.value)}
                    className="w-full bg-navy/80 border border-white/30 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-saffron font-medium"
                  >
                    <option value="OFFICER" className="bg-navy text-white">OFFICER</option>
                    <option value="ADMIN" className="bg-navy text-white">ADMIN</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-white/70">LoA Level</label>
                  <select 
                    value={devLoa}
                    onChange={(e) => setDevLoa(e.target.value)}
                    className="w-full bg-navy/80 border border-white/30 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-saffron font-medium"
                  >
                    <option value="LOA_3_BIOMETRIC" className="bg-navy text-white">LOA_3_BIOMETRIC</option>
                    <option value="LOA_2_OTP" className="bg-navy text-white">LOA_2_OTP</option>
                  </select>
                </div>
              </div>
              
              <button
                onClick={handleDevLogin}
                disabled={isDevLoggingIn}
                className="w-full flex items-center justify-center gap-2 py-3 bg-saffron hover:bg-saffron-dark text-navy font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {isDevLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
                Sign In as Demo Official
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
