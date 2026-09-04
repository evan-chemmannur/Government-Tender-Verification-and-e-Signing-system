import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { Building2, Calendar } from 'lucide-react';

export const formatCurrency = (amountInr) => {
  if (amountInr === undefined || amountInr === null) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amountInr);
};

export const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateStr));
};

export default function TenderCard({ tender }) {
  // Determine left border color based on status
  let borderLeftColor = 'border-l-border';
  if (tender.status === 'PUBLISHED') borderLeftColor = 'border-l-saffron';
  if (tender.status === 'AWARDED' || tender.status === 'SIGNED') borderLeftColor = 'border-l-success';
  if (tender.status === 'REVOKED' || tender.status === 'CANCELLED') borderLeftColor = 'border-l-danger';
  if (tender.status === 'DRAFT') borderLeftColor = 'border-l-muted';

  return (
    <Link 
      to={`/tenders/${tender.id}`}
      className={`block bg-card rounded-xl shadow-sm border-y border-r border-l-[4px] border-border ${borderLeftColor} hover:shadow-lg hover:-translate-y-1 transition-all duration-300 overflow-hidden group focus-visible:ring-2 focus-visible:ring-saffron focus:outline-none`}
    >
      <div className="p-5">
        <div className="flex justify-between items-start mb-3">
          <span className="text-xs font-mono font-semibold text-muted uppercase tracking-wider bg-surface px-2 py-1 rounded">
            {tender.tender_id}
          </span>
          <StatusBadge status={tender.status} />
        </div>
        
        <h3 className="text-lg font-bold text-navy mb-3 group-hover:text-institutional-blue transition-colors line-clamp-2 leading-snug">
          {tender.title}
        </h3>
        
        <div className="flex items-center text-sm font-medium text-muted mb-5">
          <Building2 className="w-4 h-4 mr-2" />
          <span className="truncate">{tender.department?.replace(/_/g, ' ')}</span>
        </div>

        <div className="pt-4 border-t border-border flex justify-between items-end">
          <div>
            <p className="text-xs font-medium text-muted mb-1">Estimated Value</p>
            <p className="text-lg font-bold text-text">
              {formatCurrency(tender.estimated_value_inr)}
            </p>
          </div>
          
          <div className="text-right">
            <p className="text-xs font-medium text-muted mb-1 flex items-center justify-end">
              <Calendar className="w-3 h-3 mr-1" /> Deadline
            </p>
            <p className="text-sm font-semibold text-text">
              {formatDate(tender.submission_deadline)}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
