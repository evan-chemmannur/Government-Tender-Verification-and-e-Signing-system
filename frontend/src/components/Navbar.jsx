import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const { officer, logout, isLoggingOut } = useAuth();

  return (
    <header className="bg-navy text-white shadow-md sticky top-0 z-40 h-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        <Link to="/tenders" className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron rounded-sm">
          {/* Ashoka Chakra inline SVG mini-icon */}
          <div className="w-8 h-8 rounded flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 100 100" className="text-saffron group-hover:text-saffron-dark transition-colors" fill="currentColor">
              <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6"/>
              <circle cx="50" cy="50" r="8" fill="currentColor"/>
              <path d="M50 10 L54 50 L50 90 L46 50 Z" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(15 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(30 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(45 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(60 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(75 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(90 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(105 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(120 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(135 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(150 50 50)" />
              <path d="M50 10 L54 50 L50 90 L46 50 Z" transform="rotate(165 50 50)" />
            </svg>
          </div>
          <span className="font-bold text-lg hidden sm:block tracking-tight">Tender Portal</span>
        </Link>

        {officer?.role === 'ADMIN' && (
          <nav className="hidden md:flex items-center gap-6 ml-8 mr-auto text-sm font-semibold">
            <Link to="/admin/dashboard" className="text-border hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron rounded-sm px-1">Dashboard</Link>
            <Link to="/admin/audit-log" className="text-border hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron rounded-sm px-1">Audit Log</Link>
            <Link to="/admin/officials" className="text-border hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron rounded-sm px-1">Officials</Link>
          </nav>
        )}

        {officer && (
          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-white">{officer.name}</p>
              {/* Role badge: pill shape, gold outline */}
              <p className="text-xs font-bold text-saffron mt-0.5 px-2 py-0.5 border border-saffron rounded-full inline-block uppercase tracking-wider">{officer.role ? officer.role.replace('_', ' ') : 'OFFICER'}</p>
            </div>
            <button 
              onClick={logout} 
              disabled={isLoggingOut}
              className="flex items-center gap-2 text-sm font-medium text-border hover:text-white px-3 py-1.5 rounded-lg hover:bg-institutional-blue transition-colors border border-transparent disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
