import React from 'react';
import { AlertTriangle } from 'lucide-react';

const VerificationResult = ({ result }) => {
  if (!result) return null;

  const isGenuine = result.status === 'GENUINE';

  return (
    <div className={`mt-6 p-6 bg-card rounded-xl shadow-md border-y border-r border-l-[6px] ${isGenuine ? 'border-l-success border-y-border border-r-border' : 'border-l-danger border-y-border border-r-border'}`}>
      <div className="flex items-start gap-4">
        {isGenuine ? (
          <div className="text-success mt-1">
            <svg width="32" height="32" viewBox="0 0 100 100" fill="currentColor">
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
        ) : (
          <AlertTriangle className="w-8 h-8 text-danger mt-1" />
        )}
        
        <div className="flex-1">
          <h3 className={`text-xl font-bold tracking-tight mb-2 ${isGenuine ? 'text-success' : 'text-danger'}`}>
            {result.status}
          </h3>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <span className="text-sm font-medium text-muted">Tender ID</span>
              <span className="text-sm font-mono font-bold text-text">{result.details?.id || 'N/A'}</span>
            </div>
            
            {isGenuine && (
              <>
                <div className="flex justify-between items-center border-b border-border pb-2">
                  <span className="text-sm font-medium text-muted">Signed By</span>
                  <span className="text-sm font-semibold text-text">{result.details?.signedBy || 'Unknown Official'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted">Verification</span>
                  <span className="text-sm font-medium text-text">Verified on {new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </>
            )}

            {!isGenuine && (
              <div className="bg-red-50 border border-red-100 p-3 rounded-lg mt-2">
                <p className="text-sm text-red-800">
                  <span className="font-bold">Revocation Reason: </span>
                  {result.reason || 'This credential has been revoked by the issuing authority and is no longer valid.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationResult;
