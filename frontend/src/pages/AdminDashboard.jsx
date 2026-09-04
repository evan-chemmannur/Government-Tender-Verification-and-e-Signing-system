import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { 
  Building2, 
  FileSignature, 
  AlertCircle, 
  Clock, 
  Activity, 
  Database, 
  HardDrive, 
  Cpu,
  Users,
  Settings,
  History,
  LayoutDashboard
} from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/statistics').then(res => res.data)
  });

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api.get('/admin/system-health').then(res => res.data),
    refetchInterval: 60000 // Refresh every minute
  });

  if (statsLoading) {
    return <div className="p-8 flex justify-center"><div className="w-10 h-10 border-4 border-navy border-t-saffron rounded-full animate-spin"></div></div>;
  }

  if (statsError || !stats) {
    return <div className="p-12 text-center text-danger font-bold text-lg">Failed to load dashboard statistics.</div>;
  }

  const { cards, departmentStats, monthlyValueStats, recentActivity, alerts } = stats;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header section */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-navy flex items-center gap-3 tracking-tight">
            <LayoutDashboard className="w-8 h-8 text-saffron" />
            System Administration
          </h1>
          <p className="text-muted mt-2 font-medium">
            Monitor system health, view audit logs, and manage government officials.
          </p>
        </div>
      </div>

      {/* Admin Quick Navigation (Frosted Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/admin/officials" className="bg-white/80 backdrop-blur-md border border-border p-5 rounded-xl shadow-sm hover:border-institutional-blue hover:shadow-md transition-all group flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-institutional-blue rounded-lg group-hover:bg-institutional-blue group-hover:text-white transition-colors">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-navy group-hover:text-institutional-blue transition-colors">Manage Officials</h3>
            <p className="text-xs text-muted font-medium mt-0.5">Add or revoke access</p>
          </div>
        </Link>
        <Link to="/" className="bg-white/80 backdrop-blur-md border border-border p-5 rounded-xl shadow-sm hover:border-institutional-blue hover:shadow-md transition-all group flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-institutional-blue rounded-lg group-hover:bg-institutional-blue group-hover:text-white transition-colors">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-navy group-hover:text-institutional-blue transition-colors">Manage Tenders</h3>
            <p className="text-xs text-muted font-medium mt-0.5">View all tenders</p>
          </div>
        </Link>
        <Link to="/admin/audit-log" className="bg-white/80 backdrop-blur-md border border-border p-5 rounded-xl shadow-sm hover:border-institutional-blue hover:shadow-md transition-all group flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-institutional-blue rounded-lg group-hover:bg-institutional-blue group-hover:text-white transition-colors">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-navy group-hover:text-institutional-blue transition-colors">Audit Logs</h3>
            <p className="text-xs text-muted font-medium mt-0.5">System-wide activity</p>
          </div>
        </Link>
        <div className="bg-white/80 backdrop-blur-md border border-border p-5 rounded-xl shadow-sm opacity-60 cursor-not-allowed flex items-center gap-4">
          <div className="p-3 bg-slate-100 text-slate-400 rounded-lg">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-600">App Settings</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Coming soon</p>
          </div>
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Tenders" 
          value={cards.totalTenders} 
          icon={<Building2 className="text-institutional-blue" />} 
          bg="bg-blue-50 border-blue-100" 
        />
        <StatCard 
          title="Signed This Month" 
          value={cards.signedThisMonth} 
          icon={<FileSignature className="text-success" />} 
          bg="bg-green-50 border-green-100" 
        />
        <StatCard 
          title="Pending Action" 
          value={cards.pendingAction} 
          icon={<Clock className="text-saffron" />} 
          bg="bg-amber-50 border-amber-100" 
        />
        <StatCard 
          title="Revoked" 
          value={cards.revoked} 
          icon={<AlertCircle className="text-danger" />} 
          bg="bg-red-50 border-red-100" 
        />
      </div>

      {/* System Health */}
      {!healthLoading && health && (
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          <h2 className="text-sm font-bold text-navy uppercase tracking-widest mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-institutional-blue" />
            System Health Status
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-institutional-blue rounded-xl shadow-sm border border-blue-100">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wider mb-0.5">DB Connections</p>
                <p className="text-xl font-bold text-navy">{health.dbConnections >= 0 ? health.dbConnections : 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-institutional-blue rounded-xl shadow-sm border border-blue-100">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wider mb-0.5">Memory Usage</p>
                <p className="text-xl font-bold text-navy">
                  {Math.round(health.memory.rss / 1024 / 1024)} MB
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-institutional-blue rounded-xl shadow-sm border border-blue-100">
                <HardDrive className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wider mb-0.5">Disk Available</p>
                <p className="text-xl font-bold text-navy">
                  {health.diskUsage.available > 0 
                    ? `${(health.diskUsage.available / 1024 / 1024 / 1024).toFixed(2)} GB`
                    : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Tenders by Department */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6 sm:p-8">
          <h2 className="text-sm font-bold text-navy uppercase tracking-widest mb-6">Tenders by Department</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DDE3EE" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7A90', fontWeight: 500 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7A90', fontWeight: 500 }} />
                <Tooltip 
                  cursor={{ fill: '#F4F7FC' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #DDE3EE', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
                />
                <Bar dataKey="value" fill="#1A6BAB" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Value by Month */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6 sm:p-8">
          <h2 className="text-sm font-bold text-navy uppercase tracking-widest mb-6">Estimated Value by Month</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyValueStats} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DDE3EE" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7A90', fontWeight: 500 }} />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#6B7A90', fontWeight: 500 }} 
                  tickFormatter={(value) => value >= 1000000 ? `₹${(value/1000000).toFixed(1)}M` : `₹${value}`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: '1px solid #DDE3EE', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
                  formatter={(value) => [`₹${parseInt(value).toLocaleString()}`, 'Total Value']}
                />
                <Line type="monotone" dataKey="value" stroke="#C8922A" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#C8922A' }} activeDot={{ r: 6, fill: '#C8922A' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-card rounded-2xl shadow-sm border border-border overflow-hidden flex flex-col h-[500px]">
          <div className="p-6 border-b border-border flex justify-between items-center bg-surface">
            <h2 className="text-sm font-bold text-navy uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-4 h-4 text-institutional-blue" />
              Recent Activity
            </h2>
            <Link to="/admin/audit-log" className="text-sm font-bold text-institutional-blue hover:text-navy transition-colors">View All Logs</Link>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            {recentActivity.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-center text-muted">
                <History className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No recent activity found.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recentActivity.map((log) => (
                  <li key={log.id} className="p-5 hover:bg-surface transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="bg-white border border-border text-muted rounded-full p-2 mt-1 shadow-sm">
                        <Activity className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-navy">
                          <span className="font-bold">{log.official_name || 'System'}</span> <span className="font-normal text-muted">performed</span> <span className="font-bold text-text">{log.action}</span>
                        </p>
                        {log.tender_title && (
                          <p className="text-sm text-muted truncate mt-0.5 font-medium">on {log.tender_title}</p>
                        )}
                        <p className="text-xs font-bold text-slate-400 mt-1.5 uppercase tracking-wider">{new Date(log.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden flex flex-col h-[500px]">
          <div className="p-6 border-b border-red-100 flex items-center gap-2 bg-red-50">
            <AlertCircle className="w-5 h-5 text-danger" />
            <h2 className="text-sm font-bold text-danger uppercase tracking-widest">Stalled Tenders (&gt; 7 Days)</h2>
          </div>
          <div className="overflow-y-auto flex-1 p-0 bg-white">
            {alerts.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-center text-muted">
                <CheckCircle className="w-10 h-10 mb-3 opacity-30 text-success" />
                <p className="text-sm font-medium">All tenders are progressing smoothly.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {alerts.map((alert) => (
                  <li key={alert.id} className="p-5 hover:bg-red-50/50 transition-colors">
                    <Link to={`/tenders/${alert.id}`} className="block">
                      <p className="text-sm font-bold text-navy leading-snug line-clamp-2 mb-2">{alert.title}</p>
                      <div className="flex justify-between items-center mt-3">
                        <span className="inline-block px-2.5 py-1 bg-amber-50 text-saffron border border-amber-200 text-[10px] font-bold tracking-widest uppercase rounded shadow-sm">
                          {alert.status}
                        </span>
                        <span className="text-xs text-danger font-bold">
                          Updated: {new Date(alert.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, bg }) {
  return (
    <div className={`bg-card rounded-2xl shadow-sm border p-6 flex items-center gap-4 transition-all hover:shadow-md ${bg.includes('border') ? 'border-border' : ''}`}>
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${bg} shadow-inner`}>
        {React.cloneElement(icon, { className: `w-7 h-7 ${icon.props.className}` })}
      </div>
      <div>
        <p className="text-xs font-bold text-muted uppercase tracking-wider mb-1">{title}</p>
        <p className="text-3xl font-bold text-navy tracking-tight">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}
