import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenders } from '../hooks/useTenders';
import TenderCard from '../components/TenderCard';
import { Search, Filter, LayoutDashboard, FileX } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function TenderList() {
  const { officer } = useAuth();
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Setup filters based on tab
  const getFilters = () => {
    if (activeTab === 'PENDING') return { status: 'APPROVED_PENDING_SIGN' };
    if (activeTab === 'SIGNED') return { status: 'SIGNED' };
    return {}; // ALL
  };

  const { data, isLoading } = useTenders(getFilters());
  
  // Client-side search filter
  const tenders = data?.data?.filter(t => 
    searchQuery === '' || 
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.tender_id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header section */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-navy flex items-center gap-3 tracking-tight">
            <LayoutDashboard className="w-8 h-8 text-saffron" />
            Active Tenders
          </h1>
          <p className="text-muted mt-2 font-medium">
            Welcome back, {officer?.name}. You are logged in as <span className="font-bold text-text">{officer?.role.replace('_', ' ')}</span>.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center justify-center bg-navy text-white px-4 py-2 rounded-lg shadow-sm">
            <span className="text-2xl font-bold mr-2">{tenders.length}</span>
            <span className="text-sm font-medium text-border uppercase tracking-wider">Total<br/>Tenders</span>
          </div>
          {(officer?.role === 'ADMIN' || officer?.role === 'OFFICER') && (
            <Link 
              to="/tenders/new" 
              className="bg-saffron hover:bg-saffron-dark text-navy font-bold py-2.5 px-5 rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-saffron flex items-center gap-2"
            >
              + Create Tender
            </Link>
          )}
        </div>
      </div>

      {/* Tabs & Search (Frosted Card) */}
      <div className="bg-white/80 backdrop-blur-md border border-border p-4 rounded-xl shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        
        <div className="flex space-x-1 bg-surface p-1 rounded-lg self-start">
          <button 
            onClick={() => setActiveTab('ALL')}
            className={`px-5 py-2.5 text-sm font-semibold rounded-md transition-all ${activeTab === 'ALL' ? 'bg-card text-navy shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron' : 'text-muted hover:text-navy hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron'}`}
          >
            All Tenders
          </button>
          <button 
            onClick={() => setActiveTab('PENDING')}
            className={`px-5 py-2.5 text-sm font-semibold rounded-md transition-all ${activeTab === 'PENDING' ? 'bg-card text-navy shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron' : 'text-muted hover:text-navy hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron'}`}
          >
            Pending Sign
          </button>
          <button 
            onClick={() => setActiveTab('SIGNED')}
            className={`px-5 py-2.5 text-sm font-semibold rounded-md transition-all ${activeTab === 'SIGNED' ? 'bg-card text-navy shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron' : 'text-muted hover:text-navy hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron'}`}
          >
            Signed
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          {/* Department Filter Mock */}
          <div className="relative w-full sm:w-48">
            <select className="appearance-none block w-full pl-3 pr-10 py-2.5 border border-border rounded-lg leading-5 bg-card text-text font-medium focus:outline-none focus:ring-2 focus:ring-saffron focus:border-transparent sm:text-sm transition-all cursor-pointer">
              <option>All Departments</option>
              <option>Public Works</option>
              <option>Health Ministry</option>
            </select>
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <Filter className="h-4 w-4 text-muted" />
            </div>
          </div>

          <div className="relative w-full sm:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-muted" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2.5 border border-border rounded-lg leading-5 bg-card text-text font-medium placeholder-muted focus:outline-none focus:ring-2 focus:ring-saffron focus:border-transparent sm:text-sm transition-all"
              placeholder="Search ID or Title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-card rounded-xl shadow-sm border border-border h-48 p-5 animate-pulse">
              <div className="h-4 bg-surface rounded w-1/4 mb-4"></div>
              <div className="h-6 bg-surface rounded w-3/4 mb-2"></div>
              <div className="h-6 bg-surface rounded w-1/2 mb-6"></div>
              <div className="border-t border-border pt-4 flex justify-between">
                <div className="h-10 bg-surface rounded w-1/3"></div>
                <div className="h-10 bg-surface rounded w-1/3"></div>
              </div>
            </div>
          ))}
        </div>
      ) : tenders.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-xl shadow-sm border border-border">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-surface mb-4">
            <FileX className="h-8 w-8 text-muted" />
          </div>
          <h3 className="text-xl font-bold text-navy">No tenders found</h3>
          <p className="mt-2 text-sm font-medium text-muted">Try adjusting your search or filter to find what you're looking for.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tenders.map(tender => (
            <TenderCard key={tender.id} tender={tender} />
          ))}
        </div>
      )}
    </div>
  );
}
