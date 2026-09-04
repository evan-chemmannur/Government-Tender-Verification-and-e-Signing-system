import { FileText, Search, CheckCircle, PenTool, XCircle, Clock } from 'lucide-react';
import clsx from 'clsx'; // I'll use standard template literals if clsx is not installed, wait it might not be. I'll use string concatenation just in case.

const StatusConfig = {
  DRAFT: { label: 'Draft', color: 'bg-gray-100 text-gray-700 border-gray-200', icon: FileText },
  SUBMITTED: { label: 'Submitted', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Clock },
  UNDER_REVIEW: { label: 'Under Review', color: 'bg-indigo-100 text-indigo-800 border-indigo-200', icon: Search },
  APPROVED_PENDING_SIGN: { label: 'Pending Sign', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: PenTool },
  SIGNED: { label: 'Signed', color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle },
  AWARDED: { label: 'Awarded', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CheckCircle },
  REVOKED: { label: 'Revoked', color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle },
};

export default function StatusBadge({ status }) {
  const config = StatusConfig[status] || { label: status, color: 'bg-gray-100 text-gray-800 border-gray-200', icon: FileText };
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`} title={`Status: ${config.label}`}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  );
}
