import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { Search, Download, Filter, FileText, ChevronDown, History, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Filters
  const [filters, setFilters] = useState({
    action: '',
    official: '',
    from: '',
    to: ''
  });

  const observer = useRef();

  const fetchLogs = async (pageNum, currentFilters, append = false) => {
    try {
      setLoading(true);
      setError(null);
      const queryParams = new URLSearchParams({
        page: pageNum,
        limit: 50,
        ...currentFilters
      });

      // Remove empty filters
      for (const [key, value] of queryParams.entries()) {
        if (!value) queryParams.delete(key);
      }

      const res = await api.get(`/admin/audit-log?${queryParams.toString()}`);
      
      if (append) {
        setLogs(prev => [...prev, ...res.data.data]);
      } else {
        setLogs(res.data.data);
      }
      
      setHasMore(res.data.pagination.page < res.data.pagination.totalPages);
    } catch (err) {
      setError('Failed to fetch audit logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    fetchLogs(1, filters, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Infinite Scroll Observer
  const lastElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => {
          const next = prevPage + 1;
          fetchLogs(next, filters, true);
          return next;
        });
      }
    }, { rootMargin: '200px' });
    
    if (node) observer.current.observe(node);
  }, [loading, hasMore, filters]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleExport = () => {
    const queryParams = new URLSearchParams(filters);
    for (const [key, value] of queryParams.entries()) {
      if (!value) queryParams.delete(key);
    }
    const url = `/api/admin/audit-log/export?${queryParams.toString()}`;
    
    api.get(url, { responseType: 'blob' })
      .then((response) => {
        const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', 'audit-log-export.csv');
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
      })
      .catch(() => alert('Export failed.'));
  };

  const getActionBadgeColor = (action) => {
    switch (action) {
      case 'SIGNED':
      case 'AWARDED':
      case 'APPROVED':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'SUBMITTED':
      case 'REVIEWED':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'REVOKED':
      case 'CANCELLED':
      case 'REJECTED':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'DRAFT':
      case 'CREATED':
        return 'bg-slate-100 text-slate-800 border-slate-200';
      default:
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 h-[calc(100vh-64px)] flex flex-col space-y-6">
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy flex items-center gap-3 tracking-tight">
            <History className="w-8 h-8 text-saffron" />
            System Audit Log
          </h1>
          <p className="text-muted mt-2 font-medium flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-institutional-blue" />
            Immutable record of all system events and operations.
          </p>
        </div>
        <button 
          onClick={handleExport}
          className="flex justify-center items-center gap-2 bg-white border-2 border-border text-navy hover:bg-surface px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-saffron"
        >
          <Download className="w-4 h-4" />
          Export to CSV
        </button>
      </div>

      {/* Filters (Frosted Card) */}
      <div className="bg-white/80 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-border flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-bold text-muted mb-1.5 uppercase tracking-wider">Action Type</label>
          <input 
            type="text" 
            name="action"
            value={filters.action}
            onChange={handleFilterChange}
            placeholder="e.g. LOGIN, SIGNED"
            className="w-full border-border rounded-lg shadow-sm focus:border-saffron focus:ring-2 focus:ring-saffron focus:ring-opacity-50 sm:text-sm px-4 py-2.5 bg-card text-text font-medium transition-all"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-bold text-muted mb-1.5 uppercase tracking-wider">Official Name/ID</label>
          <input 
            type="text" 
            name="official"
            value={filters.official}
            onChange={handleFilterChange}
            placeholder="Search official..."
            className="w-full border-border rounded-lg shadow-sm focus:border-saffron focus:ring-2 focus:ring-saffron focus:ring-opacity-50 sm:text-sm px-4 py-2.5 bg-card text-text font-medium transition-all"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-bold text-muted mb-1.5 uppercase tracking-wider">From Date</label>
          <input 
            type="date" 
            name="from"
            value={filters.from}
            onChange={handleFilterChange}
            className="w-full border-border rounded-lg shadow-sm focus:border-saffron focus:ring-2 focus:ring-saffron focus:ring-opacity-50 sm:text-sm px-4 py-2.5 bg-card text-text font-medium transition-all"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-bold text-muted mb-1.5 uppercase tracking-wider">To Date</label>
          <input 
            type="date" 
            name="to"
            value={filters.to}
            onChange={handleFilterChange}
            className="w-full border-border rounded-lg shadow-sm focus:border-saffron focus:ring-2 focus:ring-saffron focus:ring-opacity-50 sm:text-sm px-4 py-2.5 bg-card text-text font-medium transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl shadow-sm border border-border flex-1 overflow-hidden flex flex-col relative">
        <div className="overflow-y-auto flex-1">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-navy sticky top-0 z-10 shadow-md">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Timestamp</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Official</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Action</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Tender</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {logs.map((log, index) => {
                const isLast = logs.length === index + 1;
                const rowClass = index % 2 === 0 ? 'bg-white' : 'bg-surface';
                return (
                  <tr key={log.id} ref={isLast ? lastElementRef : null} className={`${rowClass} hover:bg-blue-50 transition-colors`}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-muted">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-bold text-navy">{log.official_name || 'System'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold tracking-wider border shadow-sm ${getActionBadgeColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {log.tender_title ? (
                        <div className="text-sm font-bold text-institutional-blue max-w-xs truncate" title={log.tender_title}>
                          {log.tender_id ? <Link to={`/tenders/${log.tender_id}`} className="hover:underline">{log.tender_title}</Link> : log.tender_title}
                        </div>
                      ) : (
                        <span className="text-sm text-muted font-bold">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-600">
                      {log.details || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          {loading && (
            <div className="p-8 flex justify-center">
              <div className="w-8 h-8 border-4 border-navy border-t-saffron rounded-full animate-spin"></div>
            </div>
          )}
          {!hasMore && logs.length > 0 && (
            <div className="p-6 text-center text-muted text-xs font-bold uppercase tracking-widest">
              End of audit log.
            </div>
          )}
          {!loading && logs.length === 0 && (
            <div className="p-16 text-center flex flex-col items-center justify-center">
              <History className="w-12 h-12 text-muted mb-4 opacity-50" />
              <p className="text-base font-bold text-navy">No audit logs match the current filters.</p>
              <p className="text-sm text-muted mt-2 font-medium">Try adjusting your search parameters.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
