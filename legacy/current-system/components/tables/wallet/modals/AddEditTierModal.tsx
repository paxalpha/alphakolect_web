"use client"
import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import adminAPI from '@/app/admin/utilis/adminApi';

interface AddEditTierModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  tierData?: any;
}

const AddEditTierModal = ({ isOpen, onClose, mode, tierData }: AddEditTierModalProps) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    level: 1,
    name: '',
    dailyLimit: 'NO',
    maxBalance: 'NO',
    fee: 'NO',
    requirements: [] as string[],
  });

  const availableRequirements = [
    'Register',
    'Name',
    'Phone number',
    'Email',
    'Government ID',
    'Selfie/face match',
    'Date of birth',
    'Business registration',
    'Director details',
    'Proof of address',
    'Bank account verification'
  ];

  useEffect(() => {
    if (mode === 'edit' && tierData) {
      setFormData({
        level: tierData.level,
        name: tierData.name,
        dailyLimit: tierData.dailyLimit || 'NO',
        maxBalance: tierData.maxBalance || 'NO',
        fee: tierData.fee || 'NO',
        requirements: tierData.requirements || [],
      });
    } else {
      setFormData({
        level: 1,
        name: '',
        dailyLimit: 'NO',
        maxBalance: 'NO',
        fee: 'NO',
        requirements: ['Register'],
      });
    }
  }, [mode, tierData, isOpen]);

  const handleRequirementToggle = (req: string) => {
    setFormData(prev => ({
      ...prev,
      requirements: prev.requirements.includes(req)
        ? prev.requirements.filter(r => r !== req)
        : [...prev.requirements, req]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'add') {
        await adminAPI.createWalletTier(formData);
        alert('Tier created successfully!');
      } else {
        await adminAPI.updateWalletTier({ ...formData, id: tierData.id });
        alert('Tier updated successfully!');
      }
      onClose();
    } catch (error: any) {
      console.error('Error saving tier:', error);
      alert(error.message || 'Failed to save tier');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />
      <div className="relative bg-white w-full max-w-[450px] h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-6 py-5 border-b sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-gray-900">{mode === 'add' ? 'Create tier' : 'Edit tier'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="h-6 w-6 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#344054] mb-1.5">Tier</label>
              <input 
                type="number" 
                value={formData.level}
                onChange={(e) => setFormData({ ...formData, level: parseInt(e.target.value) })}
                className="w-full border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-[#F9FAFB]" 
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#344054] mb-1.5">Name</label>
              <input 
                type="text" 
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" 
                placeholder="Enter name"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#344054] mb-1.5">Daily transaction limit</label>
              <input 
                type="text" 
                value={formData.dailyLimit}
                onChange={(e) => setFormData({ ...formData, dailyLimit: e.target.value })}
                className="w-full border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" 
                placeholder="Enter limit or NO"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#344054] mb-1.5">Maximum balance</label>
              <input 
                type="text" 
                value={formData.maxBalance}
                onChange={(e) => setFormData({ ...formData, maxBalance: e.target.value })}
                className="w-full border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" 
                placeholder="Enter limit or NO"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#344054] mb-1.5">Fee to pay</label>
              <input 
                type="text" 
                value={formData.fee}
                onChange={(e) => setFormData({ ...formData, fee: e.target.value })}
                className="w-full border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" 
                placeholder="Enter amount or NO"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#344054] mb-3">Requirements</label>
              <div className="grid grid-cols-1 gap-3">
                {availableRequirements.map((req) => (
                  <label key={req} className="flex items-center group cursor-pointer">
                    <div className="relative flex items-center">
                      <input 
                        type="checkbox" 
                        checked={formData.requirements.includes(req)}
                        onChange={() => handleRequirementToggle(req)}
                        className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-[#D0D5DD] checked:bg-[#4E37FB] checked:border-[#4E37FB] transition-all"
                      />
                      <svg
                        className="absolute h-3.5 w-3.5 top-0.5 left-0.5 hidden peer-checked:block pointer-events-none text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </div>
                    <span className="ml-3 text-sm text-[#344054] group-hover:text-indigo-600 transition-colors">{req}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t flex justify-center sticky bottom-0 bg-white pb-6">
            <button 
              type="submit"
              disabled={loading}
              className="w-full max-w-[200px] bg-[#4E37FB] text-white py-3 rounded-lg font-bold text-sm tracking-wide hover:bg-[#3d2dd8] transition-all transform active:scale-95 shadow-md disabled:opacity-50"
            >
              {loading ? 'Processing...' : (mode === 'add' ? 'Create tier' : 'Update tier')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddEditTierModal;
