"use client"
import React, { useState } from 'react'
import { X as CloseIcon, Check, AlertCircle, ExternalLink, FileText, User, Calendar, MapPin, Briefcase, ChevronRight, Globe, Phone } from 'lucide-react'
import adminAPI from '@/app/admin/utilis/adminApi';

interface VerificationDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: any;
  onActionComplete: () => void;
}

const VerificationDetailsModal = ({ isOpen, onClose, request, onActionComplete }: VerificationDetailsModalProps) => {
  const [loading, setLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  if (!isOpen || !request) return null;

  const handleAction = async (status: 'approved' | 'rejected') => {
    if (status === 'rejected' && !rejectionReason) {
      alert('Please provide a reason for rejection');
      return;
    }

    setLoading(true);
    try {
      await adminAPI.updateVerificationStatus(request.id, status, rejectionReason);
      alert(`Request ${status === 'approved' ? 'approved' : 'declined'} successfully`);
      onActionComplete();
      onClose();
    } catch (error: any) {
      alert(error.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const metadata = request.metadata || {};
  const documents = request.documents || {};

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-end font-inter">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-300" 
        onClick={onClose} 
      />
      
      {/* Panel */}
      <div className="relative bg-white w-full max-w-[550px] h-full shadow-[-20px_0_50px_rgba(0,0,0,0.1)] overflow-hidden flex flex-col animate-in slide-in-from-right duration-500 ease-out">
        
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 bg-white z-10 shrink-0">
          <div>
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded mb-2 inline-block ${
              request.status === 'pending' ? 'bg-amber-50 text-amber-600' : 
              request.status === 'approved' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
            }`}>
              {request.status} Request
            </span>
            <h2 className="text-xl font-extrabold text-[#101828]">Verification Details</h2>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              Ref ID: <span className="font-mono font-medium text-slate-600">REQ-{request.id.toString().padStart(6, '0')}</span>
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-2.5 hover:bg-slate-50 rounded-xl border border-transparent hover:border-slate-100 transition-all text-slate-400 hover:text-slate-600 focus:outline-none"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Content Wrapper */}
        <div className="flex-1 overflow-y-auto px-8 py-8 space-y-10 custom-scrollbar">
          
          {/* Summary Card */}
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Requested Tier</p>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-400 line-through">Tier {request.currentLevel}</span>
                <ChevronRight size={14} className="text-slate-300" />
                <span className="text-2xl font-black text-[#4E37FB]">Tier {request.targetLevel}</span>
              </div>
            </div>
            <div className="text-right space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Submission Date</p>
              <p className="text-sm font-semibold text-slate-700">{new Date(request.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
            </div>
          </div>

          {/* Business Section */}
          <section className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1.5 bg-indigo-500 rounded-full" />
              <h3 className="text-sm font-black text-[#101828] uppercase tracking-wider">Merchant Profile</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <InfoItem icon={<Briefcase size={16} />} label="Business Name" value={request.Merchant?.businessName} />
              <InfoItem icon={<User size={16} />} label="Full Name" value={metadata.fullName || 'N/A'} />
              <InfoItem icon={<Phone size={16} />} label="Phone Number" value={request.Merchant?.phone || 'N/A'} />
              <InfoItem icon={<Globe size={16} />} label="Email Address" value={request.Merchant?.email} />
              <InfoItem icon={<Calendar size={16} />} label="Date of Birth" value={metadata.dob || 'N/A'} />
              <InfoItem icon={<FileText size={16} />} label="ID Document Type" value={metadata.idType || 'N/A'} />
              {metadata.rcNumber && <InfoItem icon={<Briefcase size={16} />} label="Registration No (RC)" value={metadata.rcNumber} />}
              {metadata.directorName && <InfoItem icon={<User size={16} />} label="Director Name" value={metadata.directorName} />}
            </div>
          </section>

          {/* Documents Section */}
          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1.5 bg-indigo-500 rounded-full" />
                <h3 className="text-sm font-black text-[#101828] uppercase tracking-wider">Evidence & Documents</h3>
              </div>
              <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">
                {Object.keys(documents).length} Files Attached
              </span>
            </div>
            
            <div className="space-y-3">
              {Object.keys(documents).length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                  <FileText className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400 font-medium">No documents uploaded for this request.</p>
                </div>
              ) : (
                Object.keys(documents).map((key) => {
                  const fileName = documents[key];
                  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
                  const fileUrl = `${apiUrl}/uploads/${fileName}`;

                  return (
                    <div key={key} className="flex items-center justify-between p-4 bg-white border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/10 rounded-2xl transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-indigo-100/50 transition-colors">
                          <FileText className="h-5 w-5 text-slate-500 group-hover:text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{key.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="text-sm font-bold text-slate-700 truncate max-w-[200px]">{fileName}</p>
                        </div>
                      </div>
                      <a 
                        href={fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[10px] font-black text-[#4E37FB] hover:text-white hover:bg-[#4E37FB] border border-indigo-100 px-4 py-2 rounded-xl transition-all shadow-sm active:scale-95"
                      >
                        VIEW DOCUMENT <ExternalLink size={12} strokeWidth={3} />
                      </a>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Rejection UI Container */}
          {showRejectForm && (
            <div className="p-6 bg-red-50 border border-red-100 rounded-2xl space-y-4 animate-in slide-in-from-bottom duration-300">
              <div className="flex items-center gap-2 text-red-700">
                <AlertCircle size={18} />
                <span className="text-sm font-black uppercase tracking-wider">Decline Justification</span>
              </div>
              <textarea 
                className="w-full bg-white border border-red-200 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none h-32 transition-all placeholder:text-red-200"
                placeholder="Briefly explain why this verification request is being declined..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowRejectForm(false)}
                  className="flex-1 py-3 text-xs font-black text-slate-500 hover:bg-slate-200/50 rounded-xl transition-colors"
                >
                  ABORT
                </button>
                <button 
                  onClick={() => handleAction('rejected')}
                  disabled={loading}
                  className="flex-[2] py-3 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-200 disabled:opacity-50"
                >
                  CONFIRM DECLINE
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {request.status === 'pending' && !showRejectForm && (
          <div className="shrink-0 p-8 border-t border-slate-50 bg-white grid grid-cols-2 gap-4">
            <button 
              onClick={() => setShowRejectForm(true)}
              className="flex items-center justify-center gap-2 py-4 border-2 border-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-red-50 hover:border-red-100 hover:text-red-600 transition-all active:scale-95"
            >
              <CloseIcon size={16} strokeWidth={3} /> Decline
            </button>
            <button 
              onClick={() => handleAction('approved')}
              disabled={loading}
              className="flex items-center justify-center gap-2 py-4 bg-[#4E37FB] text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-[#3d2dd8] transition-all transform active:scale-95 shadow-2xl shadow-indigo-200 disabled:opacity-50"
            >
              <Check size={16} strokeWidth={3} /> {loading ? 'Processing...' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const InfoItem = ({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) => (
  <div className="flex items-start gap-4">
    <div className="bg-slate-50 p-2 rounded-lg text-slate-400">
      {icon}
    </div>
    <div className="space-y-0.5">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-sm font-bold text-slate-700">{value || 'N/A'}</p>
    </div>
  </div>
);

export default VerificationDetailsModal;
