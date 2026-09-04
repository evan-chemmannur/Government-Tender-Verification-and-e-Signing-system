import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import toast from 'react-hot-toast';
import { UserCheck, UserX, Shield, ShieldAlert, History, X, Users, Settings } from 'lucide-react';

export default function OfficialManagement() {
  const queryClient = useQueryClient();
  const [historyModalUser, setHistoryModalUser] = useState(null);

  const { data: officials, isLoading } = useQuery({
    queryKey: ['officials'],
    queryFn: () => api.get('/admin/officials').then(res => res.data)
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }) => api.put(`/admin/officials/${id}/role`, { role }),
    onSuccess: () => {
      toast.success('Role updated successfully');
      queryClient.invalidateQueries({ queryKey: ['officials'] });
    },
    onError: () => {
      toast.error('Failed to update role');
    }
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/admin/officials/${id}/status`, { is_active }),
    onSuccess: () => {
      toast.success('Status updated successfully');
      queryClient.invalidateQueries({ queryKey: ['officials'] });
    },
    onError: () => {
      toast.error('Failed to update status');
    }
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><div className="w-10 h-10 border-4 border-navy border-t-saffron rounded-full animate-spin"></div></div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy flex items-center gap-3 tracking-tight">
            <Users className="w-8 h-8 text-saffron" />
            Official Management
          </h1>
          <p className="text-muted mt-2 font-medium flex items-center gap-2">
            <Settings className="w-4 h-4 text-institutional-blue" />
            Manage system access, roles, and accounts for government officials.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-navy">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Name / ID</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Department</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Status</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Role</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-white uppercase tracking-widest whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {officials?.map((official, index) => {
                const rowClass = index % 2 === 0 ? 'bg-white' : 'bg-surface';
                return (
                  <tr key={official.id} className={`${!official.is_active ? 'bg-red-50/30' : rowClass} hover:bg-blue-50 transition-colors`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-navy">{official.name}</div>
                      <div className="text-xs text-muted font-medium uppercase tracking-wide mt-1">{official.id}</div>
                      <div className="text-xs text-institutional-blue mt-0.5 font-medium">{official.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-slate-700">{official.department}</div>
                      <div className="text-xs text-muted font-medium mt-1 uppercase tracking-wide">{official.designation}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wider border shadow-sm ${official.is_active ? 'bg-green-50 text-success border-green-200' : 'bg-red-50 text-danger border-red-200'}`}>
                        {official.is_active ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                        {official.is_active ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={official.role}
                        onChange={(e) => updateRole.mutate({ id: official.id, role: e.target.value })}
                        disabled={updateRole.isPending}
                        className="block w-full pl-3 pr-10 py-2 text-sm border-border font-bold text-navy focus:outline-none focus:ring-2 focus:ring-saffron focus:border-transparent rounded-lg shadow-sm bg-card transition-all"
                      >
                        <option value="OFFICER">OFFICER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium flex items-center gap-3">
                      <button
                        onClick={() => updateStatus.mutate({ id: official.id, is_active: !official.is_active })}
                        disabled={updateStatus.isPending}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all border shadow-sm font-bold text-xs uppercase tracking-wider ${official.is_active ? 'text-danger bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300' : 'text-success bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300'}`}
                      >
                        {official.is_active ? <ShieldAlert className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                        {official.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => setHistoryModalUser(official)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all border shadow-sm font-bold text-xs uppercase tracking-wider text-institutional-blue bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300"
                      >
                        <History className="w-4 h-4" />
                        History
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {historyModalUser && (
        <LoginHistoryModal 
          official={historyModalUser} 
          onClose={() => setHistoryModalUser(null)} 
        />
      )}
    </div>
  );
}

function LoginHistoryModal({ official, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['login-history', official.id],
    queryFn: () => api.get(`/admin/audit-log?official=${official.id}&action=LOGIN&limit=10`).then(res => res.data)
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-navy/80 backdrop-blur-sm" onClick={onClose} />
        
        <div className="relative inline-block w-full max-w-2xl text-left align-middle transition-all transform bg-card rounded-2xl shadow-2xl border border-border">
          <div className="flex items-center justify-between px-8 py-5 border-b border-border bg-surface rounded-t-2xl">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <History className="w-5 h-5 text-institutional-blue" />
              Login History - {official.name}
            </h3>
            <button onClick={onClose} className="text-muted hover:text-danger transition-colors bg-white border border-border rounded-lg p-1.5 hover:bg-red-50 hover:border-red-200">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="px-8 py-6">
            {isLoading ? (
              <div className="py-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-navy border-t-saffron rounded-full animate-spin"></div>
              </div>
            ) : data?.data?.length === 0 ? (
              <div className="py-12 text-center text-muted font-bold text-sm uppercase tracking-widest">No login records found for this user.</div>
            ) : (
              <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                {data.data.map((log, index) => (
                  <li key={log.id} className={`px-5 py-4 flex justify-between items-center ${index % 2 === 0 ? 'bg-white' : 'bg-surface'}`}>
                    <div>
                      <p className="text-sm font-bold text-navy">{new Date(log.timestamp).toLocaleString()}</p>
                      <p className="text-xs text-muted font-medium uppercase tracking-wider mt-1">IP: <span className="text-slate-600 font-bold">{log.ip_address || 'Unknown'}</span></p>
                    </div>
                    <span className="px-3 py-1 bg-green-50 text-success border border-green-200 text-xs font-bold tracking-widest uppercase rounded shadow-sm">SUCCESS</span>
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
