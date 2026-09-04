import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    CheckCircle, XCircle, AlertTriangle, ShieldAlert, Shield,
    Loader2, Printer, Share2, RotateCcw, Building2, Eye, ChevronDown, ChevronUp, FileText, Scan
} from 'lucide-react';
import QRScanner from '../components/QRScanner';
import VerificationResult from '../components/VerificationResult';
import {
    verifyTenderAward,
    decodePixelPassQR
} from '../services/verificationService';

// ─────────────────────────────────────────────────────────
// Step Progress Bar
// ─────────────────────────────────────────────────────────
function StepProgress({ steps, currentStepName }) {
    const allStepNames = [
        'Decoding QR code...',
        'Verifying document structure...',
        'Resolving issuer identity...',
        'Verifying cryptographic signature...',
        'Checking revocation status...',
        'Checking expiry...',
        'Verification complete.',
    ];

    return (
        <div className="space-y-3 mt-6">
            {allStepNames.map((name, i) => {
                const done = steps.find(s => s.name === name.replace('...', '').replace('.', ''));
                const running = currentStepName === name;
                const passed = done?.passed;

                return (
                    <div key={i} className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 ${running ? 'bg-indigo-50 border border-indigo-200 shadow-sm' : done ? 'opacity-100' : 'opacity-40'}`}>
                        <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                            {running ? (
                                <Loader2 className="w-5 h-5 text-institutional-blue animate-spin" />
                            ) : done !== undefined ? (
                                passed
                                    ? <CheckCircle className="w-5 h-5 text-success" />
                                    : <XCircle className="w-5 h-5 text-danger" />
                            ) : (
                                <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                            )}
                        </div>
                        <span className={`text-sm ${running ? 'text-navy font-bold' : done ? (passed ? 'text-slate-700 font-medium' : 'text-red-500 font-medium') : 'text-slate-500 font-medium'}`}>
                            {name}
                        </span>
                        {done && (
                            <span className={`ml-auto text-xs font-bold tracking-wider ${passed ? 'text-success' : 'text-danger'}`}>
                                {passed ? 'PASS' : 'FAIL'}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// Main Verify Page
// ─────────────────────────────────────────────────────────
export default function VerifyPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [phase, setPhase] = useState('input'); // 'input' | 'verifying' | 'done'
    const [steps, setSteps] = useState([]);
    const [currentStepName, setCurrentStepName] = useState('');
    const [result, setResult] = useState(null);
    const [manualInput, setManualInput] = useState('');
    const abortRef = useRef(false);

    useEffect(() => {
        const vcParam = searchParams.get('vc');
        const tenderParam = searchParams.get('tender');

        if (vcParam) {
            runVerification(vcParam);
        } else if (tenderParam) {
            fetchAndVerifyTender(tenderParam);
        }
    }, []);

    const fetchAndVerifyTender = async (tenderId) => {
        setPhase('verifying');
        try {
            const res = await fetch(`/api/public/vc/${tenderId}`);
            if (!res.ok) {
                setResult({ verdict: 'ERROR', steps: [], error: `Could not load tender: HTTP ${res.status}`, claims: null });
                setPhase('done');
                return;
            }
            const data = await res.json();
            runVerification(data.vc);
        } catch (e) {
            setResult({ verdict: 'ERROR', steps: [], error: e.message, claims: null });
            setPhase('done');
        }
    };

    const runVerification = useCallback(async (payload) => {
        abortRef.current = false;
        setPhase('verifying');
        setSteps([]);
        setCurrentStepName('');
        setResult(null);

        const finalResult = await verifyTenderAward(payload, (currentStep, allSteps) => {
            if (abortRef.current) return;
            if (currentStep.running) {
                setCurrentStepName(currentStep.name);
            } else {
                setCurrentStepName('');
            }
            setSteps([...allSteps]);
        });

        if (!abortRef.current) {
            setResult(finalResult);
            setPhase('done');
            if (typeof payload === 'string') {
                setSearchParams({ vc: payload.slice(0, 200) }, { replace: true });
            }
        }
    }, [setSearchParams]);

    const handleReset = () => {
        abortRef.current = true;
        setPhase('input');
        setSteps([]);
        setResult(null);
        setManualInput('');
        setCurrentStepName('');
        setSearchParams({}, { replace: true });
    };

    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualInput.trim()) {
            runVerification(manualInput.trim());
        }
    };

    return (
        <div className="min-h-screen bg-surface flex flex-col">
            {/* Header */}
            <header className="bg-navy shadow-md sticky top-0 z-40">
                <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded flex items-center justify-center">
                            <svg width="24" height="24" viewBox="0 0 100 100" className="text-saffron" fill="currentColor">
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
                        <span className="font-bold text-lg text-white tracking-tight">Public Verification Portal</span>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-12 flex flex-col items-center">
                
                {phase === 'input' && (
                    <div className="w-full text-center mb-10">
                        <h1 className="text-3xl sm:text-4xl font-bold text-navy mb-4 tracking-tight">Verify Tender Award</h1>
                        <p className="text-muted text-base sm:text-lg">Scan the QR code on any printed Government Tender Award to instantly verify its authenticity and digital signatures.</p>
                    </div>
                )}

                {/* ── INPUT PHASE ────────────────────────────────── */}
                {phase === 'input' && (
                    <div className="w-full max-w-2xl bg-card rounded-2xl shadow-xl border border-border p-8">
                        
                        {/* QR Scanner */}
                        <div className="mb-10 relative">
                            {/* Animated Corner Brackets */}
                            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-navy -translate-x-2 -translate-y-2 pointer-events-none"></div>
                            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-navy translate-x-2 -translate-y-2 pointer-events-none"></div>
                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-navy -translate-x-2 translate-y-2 pointer-events-none"></div>
                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-navy translate-x-2 translate-y-2 pointer-events-none"></div>
                            
                            <div className="bg-slate-50 border-2 border-dashed border-border rounded-xl p-2 overflow-hidden aspect-square sm:aspect-video flex items-center justify-center">
                                <QRScanner
                                    onScanSuccess={(text) => runVerification(text)}
                                    onScanError={(err) => console.warn('QR scan error:', err)}
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-4 mb-8">
                            <div className="h-px bg-border flex-1"></div>
                            <span className="text-xs font-bold text-muted uppercase tracking-widest">Or</span>
                            <div className="h-px bg-border flex-1"></div>
                        </div>

                        {/* Manual paste */}
                        <form onSubmit={handleManualSubmit} className="space-y-4">
                            <h2 className="text-sm font-bold text-navy flex items-center gap-2">
                                <FileText className="w-4 h-4 text-institutional-blue" /> Paste VC JSON
                            </h2>
                            <textarea
                                value={manualInput}
                                onChange={e => setManualInput(e.target.value)}
                                placeholder="Paste the Verifiable Credential JSON data here..."
                                rows={4}
                                className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-text placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-saffron focus:border-transparent transition-all font-mono resize-none shadow-inner"
                            />
                            <button
                                type="submit"
                                disabled={!manualInput.trim()}
                                className="w-full py-4 bg-navy hover:bg-institutional-blue disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-md flex justify-center items-center gap-2"
                            >
                                <Scan className="w-5 h-5" /> Verify Data
                            </button>
                        </form>
                    </div>
                )}

                {/* ── VERIFYING PHASE ───────────────────────────── */}
                {phase === 'verifying' && (
                    <div className="w-full max-w-xl bg-card rounded-2xl shadow-xl border border-border p-10">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 border-4 border-navy border-t-saffron rounded-full animate-spin mx-auto mb-6"></div>
                            <h2 className="text-2xl font-bold text-navy mb-2 tracking-tight">Verifying Document</h2>
                            <p className="text-muted font-medium">
                                {currentStepName || 'Initializing verification…'}
                            </p>
                        </div>
                        <StepProgress steps={steps} currentStepName={currentStepName} />
                    </div>
                )}

                {/* ── DONE PHASE ────────────────────────────────── */}
                {phase === 'done' && result && (
                    <div className="w-full max-w-2xl">
                        <VerificationResult 
                            result={{ 
                                status: result.verdict, 
                                details: result.claims ? { id: result.claims.tenderId, signedBy: result.claims.approvedBy } : null,
                                reason: result.error || (result.revokedAt ? `Revoked on ${new Date(result.revokedAt).toLocaleDateString()}` : null)
                            }} 
                        />
                        
                        <div className="mt-8 flex justify-center">
                            <button
                                onClick={handleReset}
                                className="flex items-center justify-center gap-2 px-6 py-3 bg-white border-2 border-navy text-navy hover:bg-surface font-bold rounded-xl transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron"
                            >
                                <RotateCcw className="w-5 h-5" />
                                Verify Another Document
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="mt-auto border-t border-border bg-surface py-8 text-center">
                <p className="text-sm font-medium text-muted">
                    This verification is publicly accessible. No account required.
                </p>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center justify-center gap-2">
                    <Shield className="w-3 h-3" /> Powered by MOSIP Inji Verify
                </p>
            </footer>
        </div>
    );
}
