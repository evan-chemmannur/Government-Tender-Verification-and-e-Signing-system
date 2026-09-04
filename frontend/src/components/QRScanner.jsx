/**
 * QRScanner.jsx — Camera and file-upload QR code scanner.
 *
 * Uses html5-qrcode library. Supports:
 * - Camera scan (with permission handling)
 * - File upload scan
 * - Responsive for mobile and desktop
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Upload, X, SwitchCamera, AlertCircle } from 'lucide-react';

export default function QRScanner({ onScanSuccess, onScanError }) {
    const [mode, setMode] = useState('idle'); // 'idle' | 'camera' | 'file'
    const [cameraError, setCameraError] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [previewText, setPreviewText] = useState(null);
    const scannerRef = useRef(null);
    const fileInputRef = useRef(null);
    const html5QrcodeRef = useRef(null);

    // ── Camera cleanup ──────────────────────────────────
    const stopCamera = useCallback(async () => {
        if (html5QrcodeRef.current) {
            try {
                await html5QrcodeRef.current.stop();
                html5QrcodeRef.current.clear();
            } catch {
                // Already stopped
            }
            html5QrcodeRef.current = null;
        }
        setScanning(false);
        setMode('idle');
    }, []);

    // ── Start Camera ────────────────────────────────────
    const startCamera = useCallback(async () => {
        setCameraError(null);
        setMode('camera');

        // Dynamically import to avoid SSR issues
        try {
            const { Html5Qrcode } = await import('html5-qrcode');
            html5QrcodeRef.current = new Html5Qrcode('qr-scanner-element');

            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                rememberLastUsedCamera: true,
            };

            await html5QrcodeRef.current.start(
                { facingMode: 'environment' }, // prefer back camera on mobile
                config,
                (decodedText) => {
                    setPreviewText(decodedText.slice(0, 80) + (decodedText.length > 80 ? '…' : ''));
                    stopCamera();
                    onScanSuccess(decodedText);
                },
                () => { /* Ignore per-frame decode errors */ }
            );
            setScanning(true);
        } catch (e) {
            setCameraError(
                e.message?.includes('Permission') || e.message?.includes('NotAllowed')
                    ? 'Camera permission denied. Please allow camera access and try again.'
                    : `Camera error: ${e.message}`
            );
            setMode('idle');
        }
    }, [onScanSuccess, stopCamera]);

    // ── File Upload ─────────────────────────────────────
    const handleFileUpload = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const { Html5Qrcode } = await import('html5-qrcode');
            const scanner = new Html5Qrcode('qr-file-element');
            const result = await scanner.scanFile(file, /* showImage */ false);
            setPreviewText(result.slice(0, 80) + (result.length > 80 ? '…' : ''));
            onScanSuccess(result);
        } catch (e) {
            const msg = e.message?.includes('No QR') ? 'No QR code found in the image.' : e.message;
            setCameraError(msg);
            if (onScanError) onScanError(msg);
        } finally {
            // Reset file input so same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [onScanSuccess, onScanError]);

    // Cleanup on unmount
    useEffect(() => {
        return () => { stopCamera(); };
    }, [stopCamera]);

    return (
        <div className="w-full">
            {/* Mode Selection Buttons */}
            {mode === 'idle' && (
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={startCamera}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-all duration-200 shadow-md hover:shadow-lg active:scale-95"
                    >
                        <Camera className="w-5 h-5" />
                        Scan with Camera
                    </button>
                    <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-all duration-200 shadow-md hover:shadow-lg cursor-pointer active:scale-95">
                        <Upload className="w-5 h-5" />
                        Upload QR Image
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                    </label>
                </div>
            )}

            {/* Camera Error */}
            {cameraError && (
                <div className="mt-3 flex items-start gap-2 p-3 bg-red-950/50 border border-red-800 rounded-lg text-red-300 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{cameraError}</span>
                    <button onClick={() => setCameraError(null)} className="ml-auto shrink-0">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Camera View */}
            {mode === 'camera' && (
                <div className="relative">
                    <div
                        id="qr-scanner-element"
                        className="w-full rounded-xl overflow-hidden border border-indigo-500/30"
                        style={{ minHeight: '300px' }}
                    />
                    <div className="absolute top-2 right-2 flex gap-2">
                        <button
                            onClick={stopCamera}
                            className="p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors backdrop-blur-sm"
                            title="Stop camera"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    {scanning && (
                        <div className="mt-2 text-center text-xs text-slate-400 animate-pulse">
                            Point camera at QR code…
                        </div>
                    )}
                </div>
            )}

            {/* Hidden element for file scanning */}
            <div id="qr-file-element" className="hidden" />

            {/* Scanned Preview */}
            {previewText && (
                <div className="mt-3 p-3 bg-green-950/50 border border-green-700 rounded-lg">
                    <p className="text-xs text-green-400 font-medium mb-1">QR Scanned:</p>
                    <p className="text-xs text-green-300 font-mono break-all">{previewText}</p>
                </div>
            )}

            {/* Return to idle from camera */}
            {mode === 'camera' && (
                <button
                    onClick={stopCamera}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 text-slate-300 text-sm rounded-lg hover:bg-slate-600 transition-colors"
                >
                    <X className="w-4 h-4" />
                    Cancel Scan
                </button>
            )}
        </div>
    );
}
