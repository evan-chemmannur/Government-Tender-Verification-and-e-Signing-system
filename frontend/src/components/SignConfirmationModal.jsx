import { AlertTriangle, Fingerprint, X, Loader2 } from 'lucide-react';

export default function SignConfirmationModal({ isOpen, onClose, onConfirm, tender, isSigning }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-navy p-4 flex justify-between items-center text-white">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-gold" />
            Digital Signature Required
          </h2>
          {!isSigning && (
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold mb-1">This action cannot be undone.</p>
              <p>You are about to digitally sign the award for this tender using your eSignet biometric credentials. This is legally binding.</p>
            </div>
          </div>

          <div className="space-y-3 mb-6 bg-slate-50 p-4 rounded-lg border border-slate-100 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Tender ID:</span>
              <span className="font-medium text-slate-900">{tender.tender_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Awarded To:</span>
              <span className="font-medium text-slate-900">{tender.awarded_to_name}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              disabled={isSigning}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              onClick={onConfirm} 
              disabled={isSigning}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-navy rounded-lg hover:bg-navy-light flex items-center justify-center gap-2 disabled:opacity-80 transition-all"
            >
              {isSigning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4" />
                  Confirm & Sign
                </>
              )}
            </button>
          </div>
          
          {isSigning && (
             <p className="text-center text-xs text-slate-500 mt-4 animate-pulse">
               Verifying eSignet Cryptographic Payload... Please do not close this window.
             </p>
          )}
        </div>
      </div>
    </div>
  );
}
