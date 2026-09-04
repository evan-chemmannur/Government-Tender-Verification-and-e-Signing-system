import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTender, useTenderMutations } from '../hooks/useTenders';
import { useAuth } from '../hooks/useAuth';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatDate } from '../components/TenderCard';
import SignConfirmationModal from '../components/SignConfirmationModal';
import { ArrowLeft, CheckCircle, Clock, FileText, Download, ShieldX, Link as LinkIcon, History, Fingerprint, FileCheck } from 'lucide-react';

export default function TenderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { officer } = useAuth();
  
  const { data: response, isLoading, isError } = useTender(id);
  const tender = response?.data;
  
  const { submit, startReview, approve, sign, revoke, remove, isSubmitting, isStartingReview, isApproving, isSigning, isRevoking, isDeleting } = useTenderMutations(id);
  
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [pdfStatus, setPdfStatus] = useState(null); // null | 'generating' | 'ready' | 'failed'
  
  if (isLoading) return (
    <div className="p-8 flex justify-center"><div className="w-10 h-10 border-4 border-navy border-t-saffron rounded-full animate-spin"></div></div>
  );
  
  if (isError || !tender) return (
    <div className="p-12 text-center text-danger font-bold text-lg">Failed to load tender.</div>
  );

  const canSubmit = tender.status === 'DRAFT' && officer.role !== 'VIEWER';
  const canStartReview = tender.status === 'SUBMITTED' && ['SENIOR_OFFICER', 'ADMIN'].includes(officer.role);
  const canApprove = tender.status === 'UNDER_REVIEW' && ['SENIOR_OFFICER', 'ADMIN'].includes(officer.role);
  const canSign = tender.status === 'APPROVED_PENDING_SIGN' && ['SENIOR_OFFICER', 'ADMIN'].includes(officer.role);
  const canRevoke = ['SIGNED', 'AWARDED'].includes(tender.status) && officer.role === 'ADMIN';

  const handleSignConfirm = () => {
    sign(undefined, {
      onSuccess: () => {
        setIsSignModalOpen(false);
      }
    });
  };

  const handleDownloadPdf = async () => {
    try {
      // First check if PDF is ready
      const statusRes = await fetch(`/api/tenders/${id}/pdf/status`, { credentials: 'include' });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.ready) {
          // PDF ready — open directly
          window.open(`/api/tenders/${id}/pdf`, '_blank');
          return;
        }
      }

      // PDF not ready yet — trigger generation
      setPdfStatus('generating');
      const genRes = await fetch(`/api/tenders/${id}/pdf/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || '' }
      });

      if (!genRes.ok) {
        setPdfStatus('failed');
        return;
      }

      // Poll every 2 seconds for up to 30 seconds
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 15) {
          clearInterval(poll);
          setPdfStatus('failed');
          return;
        }

        try {
          const pollRes = await fetch(`/api/tenders/${id}/pdf/status`, { credentials: 'include' });
          if (pollRes.ok) {
            const data = await pollRes.json();
            if (data.ready) {
              clearInterval(poll);
              setPdfStatus('ready');
              window.open(`/api/tenders/${id}/pdf`, '_blank');
            } else if (data.error) {
              clearInterval(poll);
              setPdfStatus('failed');
            }
          } else {
            // Treat 404 or 500 as failure and stop polling
            clearInterval(poll);
            setPdfStatus('failed');
          }
        } catch (e) {
          clearInterval(poll);
          setPdfStatus('failed');
        }
      }, 2000);
    } catch (e) {
      setPdfStatus('failed');
      console.error(e);
    }
  };

  // Determine banner color
  let bannerBg = 'bg-surface';
  let bannerBorder = 'border-border';
  if (tender.status === 'PUBLISHED') { bannerBg = 'bg-amber-50'; bannerBorder = 'border-saffron'; }
  if (['AWARDED', 'SIGNED'].includes(tender.status)) { bannerBg = 'bg-green-50'; bannerBorder = 'border-success'; }
  if (['REVOKED', 'CANCELLED'].includes(tender.status)) { bannerBg = 'bg-red-50'; bannerBorder = 'border-danger'; }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back Button */}
      <button onClick={() => navigate(-1)} className="text-muted hover:text-navy flex items-center gap-1.5 text-sm font-semibold transition-colors w-max mb-6 focus-visible:ring-2 focus-visible:ring-saffron rounded">
        <ArrowLeft className="w-4 h-4" /> Back to Tenders
      </button>

      {/* Dynamic Status Banner */}
      <div className={`w-full ${bannerBg} border-l-4 ${bannerBorder} p-4 rounded-r-xl shadow-sm mb-6 flex justify-between items-center`}>
        <div className="flex items-center gap-3">
          <StatusBadge status={tender.status} />
          {['SIGNED', 'AWARDED'].includes(tender.status) && (
            <span className="flex items-center gap-1.5 text-success font-bold text-sm bg-white px-3 py-1 rounded-full shadow-sm border border-green-200">
              <CheckCircle className="w-4 h-4" /> GENUINE — Cryptographically Verified
            </span>
          )}
        </div>
        <span className="text-sm font-mono font-bold text-muted bg-white/50 px-2 py-1 rounded">
          {tender.tender_id}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT COLUMN: Document & Details (65% ~ 8 cols) */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
            <h1 className="text-3xl font-bold text-navy mb-4 tracking-tight leading-snug">{tender.title}</h1>
            <p className="text-muted mb-8 whitespace-pre-wrap leading-relaxed">{tender.description}</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-8 gap-x-8 pt-8 border-t border-border">
              <div>
                <p className="text-sm font-medium text-muted mb-1">Department</p>
                <p className="text-lg text-text font-bold">{tender.department.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted mb-1">Category</p>
                <p className="text-lg text-text font-bold">{tender.category}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted mb-1">Estimated Value</p>
                <p className="text-2xl text-navy font-bold">{formatCurrency(tender.estimated_value_inr)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted mb-1 flex items-center gap-1">
                  <Clock className="w-4 h-4" /> Submission Deadline
                </p>
                <p className="text-lg text-text font-bold">{formatDate(tender.submission_deadline)}</p>
              </div>
            </div>
          </div>

          {['SIGNED', 'AWARDED'].includes(tender.status) && tender.awarded_to_name && (
            <div className="bg-green-50 rounded-2xl shadow-sm border border-green-200 p-8 flex gap-6 items-center">
              <div className="bg-white p-4 rounded-full shadow-sm border border-green-100">
                <FileCheck className="w-10 h-10 text-success" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-success uppercase tracking-wider mb-1">Awarded Contract</h3>
                <p className="text-xl font-bold text-green-950">{tender.awarded_to_name}</p>
                <p className="text-sm font-medium text-green-800 mt-1">GSTIN: {tender.awarded_to_gstin}</p>
                
                {/* Official signed state requirement */}
                <div className="mt-4 pt-4 border-t border-green-200/60 flex items-center gap-2 text-sm text-green-800 font-medium">
                  <Fingerprint className="w-4 h-4 text-success" />
                  Signed by {tender.audit_history?.find(h => h.action === 'SIGNED')?.official_name || 'Authorized Official'} on {formatDate(tender.audit_history?.find(h => h.action === 'SIGNED')?.timestamp || tender.updated_at)}
                </div>
              </div>
            </div>
          )}

          {/* Document Preview Area (PDF Thumbnail Placeholder) */}
          <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
             <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-6 flex items-center gap-2">
               <FileText className="w-5 h-5 text-institutional-blue" /> Attached Documents
             </h3>
             {tender.documents?.length > 0 ? (
               <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                 {tender.documents.map(doc => (
                   <div key={doc.id} className="group cursor-pointer">
                     <div className="aspect-[3/4] bg-surface border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center mb-3 group-hover:border-institutional-blue group-hover:bg-blue-50/50 transition-colors">
                       <FileText className="w-12 h-12 text-muted group-hover:text-institutional-blue mb-2 transition-colors" />
                       <span className="text-xs font-bold text-muted group-hover:text-institutional-blue px-2 py-1 bg-white rounded shadow-sm">PDF</span>
                     </div>
                     <p className="text-sm font-medium text-text group-hover:text-institutional-blue truncate text-center px-1">
                       {doc.original_filename}
                     </p>
                   </div>
                 ))}
               </div>
             ) : (
               <div className="py-12 flex flex-col items-center justify-center bg-surface rounded-xl border border-dashed border-border">
                  <FileText className="w-12 h-12 text-muted mb-3 opacity-50" />
                  <p className="text-sm font-medium text-muted">No documents attached yet.</p>
               </div>
             )}
          </div>
          
          {/* Audit History */}
          <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
             <h2 className="text-sm font-bold text-navy uppercase tracking-widest mb-6 flex items-center gap-2">
               <History className="w-5 h-5 text-institutional-blue" /> Audit Trail
             </h2>
             {tender.audit_history?.length > 0 ? (
               <div className="space-y-6">
                 {tender.audit_history.map((log, idx) => (
                   <div key={log.id} className="flex gap-5">
                     <div className="flex flex-col items-center">
                       <div className="w-3 h-3 rounded-full bg-institutional-blue mt-1 shadow-sm"></div>
                       {idx !== tender.audit_history.length - 1 && <div className="w-0.5 h-full bg-border mt-2"></div>}
                     </div>
                     <div className="pb-2">
                       <p className="text-base font-bold text-text">{log.action}</p>
                       <p className="text-sm font-medium text-muted mt-1">
                         by <span className="text-navy">{log.official_name || 'System'}</span> • {formatDate(log.timestamp)}
                       </p>
                     </div>
                   </div>
                 ))}
               </div>
             ) : (
               <p className="text-sm font-medium text-muted italic">No history available</p>
             )}
          </div>
        </div>

        {/* RIGHT COLUMN: Action Sidebar (35% ~ 4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-card rounded-2xl shadow-lg border border-border p-6 sticky top-24">
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-6 pb-3 border-b border-border">
              Action Panel
            </h3>
            
            <div className="space-y-4">
              {canSubmit && (
                <>
                  <button onClick={() => submit()} disabled={isSubmitting || isDeleting} className="w-full btn-secondary">
                    {isSubmitting ? 'Submitting...' : 'Submit for Review'}
                  </button>
                  <button 
                    onClick={() => {
                      if(window.confirm('Are you sure you want to permanently delete this draft?')) {
                        remove(undefined, { onSuccess: () => navigate('/tenders') });
                      }
                    }} 
                    disabled={isDeleting || isSubmitting} 
                    className="w-full bg-white text-danger border-2 border-danger hover:bg-red-50 font-bold py-2.5 px-4 rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all mt-2"
                  >
                    <ShieldX className="w-4 h-4" />
                    {isDeleting ? 'Deleting...' : 'Delete Draft'}
                  </button>
                </>
              )}
              
              {canStartReview && (
                <button onClick={() => startReview()} disabled={isStartingReview} className="w-full btn-secondary">
                  {isStartingReview ? 'Starting...' : 'Start Review'}
                </button>
              )}
              
              {canApprove && (
                <button onClick={() => approve()} disabled={isApproving} className="w-full btn-secondary">
                  {isApproving ? 'Approving...' : 'Approve for Signing'}
                </button>
              )}
              
              {canSign && (
                <button 
                  onClick={() => setIsSignModalOpen(true)} 
                  disabled={isSigning} 
                  className="w-full bg-saffron hover:bg-saffron-dark text-white font-bold py-4 px-4 rounded-xl shadow-md flex items-center justify-center gap-3 transition-all"
                >
                  <Fingerprint className="w-6 h-6" />
                  Sign Award (Biometric)
                </button>
              )}
              
              {['SIGNED', 'AWARDED'].includes(tender.status) && (
                <>
                  <button 
                    onClick={handleDownloadPdf} 
                    disabled={pdfStatus === 'generating'}
                    className="w-full bg-white text-navy border-2 border-navy hover:bg-surface font-bold py-3 px-4 rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                  >
                    <Download className="w-5 h-5" />
                    {pdfStatus === 'generating' ? 'Generating PDF...' : pdfStatus === 'failed' ? 'Generation Failed — Retry' : 'Download Stamped PDF'}
                  </button>
                  {pdfStatus === 'generating' && (
                    <p className="text-xs text-center text-muted mt-1 animate-pulse">PDF is being generated, please wait...</p>
                  )}
                  <button onClick={() => window.open(`/api/tenders/${id}/vc`, '_blank')} className="w-full bg-white text-institutional-blue border-2 border-institutional-blue hover:bg-blue-50 font-bold py-3 px-4 rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all">
                    <LinkIcon className="w-5 h-5" /> View Raw VC
                  </button>
                </>
              )}

              {canRevoke && (
                <button 
                  onClick={() => {
                    const reason = prompt("Enter revocation reason (e.g. FRAUD_DETECTED):");
                    if (reason) revoke({ reason, notes: 'Manually revoked via portal' });
                  }}
                  disabled={isRevoking} 
                  className="w-full mt-6 bg-white text-danger border-2 border-danger hover:bg-red-50 font-bold py-3 px-4 rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all"
                >
                  <ShieldX className="w-5 h-5" />
                  {isRevoking ? 'Revoking...' : 'Revoke Tender'}
                </button>
              )}

              {!canSubmit && !canStartReview && !canApprove && !canSign && !canRevoke && !['SIGNED', 'AWARDED'].includes(tender.status) && (
                <div className="p-4 bg-surface rounded-lg border border-border text-center">
                  <p className="text-sm font-medium text-muted">
                    No actions available for your role at this stage.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SignConfirmationModal 
        isOpen={isSignModalOpen} 
        onClose={() => !isSigning && setIsSignModalOpen(false)}
        onConfirm={handleSignConfirm}
        tender={tender}
        isSigning={isSigning}
      />
    </div>
  );
}
