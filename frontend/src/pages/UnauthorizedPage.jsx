export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-navy mb-4">403</h1>
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Access Restricted</h2>
        <p className="text-slate-600 mb-8">
          You do not have the required permissions or role to view this page. If you believe this is an error, please contact your department administrator.
        </p>
        <button onClick={() => window.location.href = '/tenders'} className="bg-navy text-white px-6 py-2 rounded-lg font-medium hover:bg-navy-light transition-colors">
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}
