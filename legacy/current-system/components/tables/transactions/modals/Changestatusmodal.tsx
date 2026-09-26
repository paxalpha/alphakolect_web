import React, { useState, useEffect } from 'react';
import { MerchantData } from '../../../../interface/type';

interface ChangestatusmodalProps {
    modalopen: boolean;
    onClose: () => void;
    bulk: string[];                    // array of selected transaction IDs
    bulker: (ids: string[]) => void;   // to clear selection
    onStatusChange: (newStatus: string, ids: string[]) => void;
}

function ChangestatusModal({
    modalopen,
    onClose,
    bulk,
    bulker,
    onStatusChange,
}: ChangestatusmodalProps) {
    const isBulk = bulk.length > 1;
    const selectedCount = bulk.length || 1;
    const selectedIds = bulk;

    const [status, setStatus] = useState<string>('active');

    // Reset status when modal opens
    useEffect(() => {
        if (modalopen) {
            setStatus('active'); // or you can set to most common, etc.
        }
    }, [modalopen]);

    const handleConfirm = () => {
        if (selectedIds.length === 0) {
            onClose();
            return;
        }

        const normalizedStatus = status.toLowerCase();

        // This updates the actual table data
        onStatusChange(normalizedStatus, selectedIds);

        // Clear selections and close modal
        bulker([]);
        onClose();

        // Optional: replace with real toast later
        // toast.success(`Status updated to "${status}" for ${selectedCount} transaction(s)`);
    };

    if (!modalopen) return null;

    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
            <div className='lg:w-[400px] w-[90%] bg-white rounded-[12px] flex flex-col gap-[20px] p-[24px] shadow-xl'>
                <h1 className='font-inter font-semibold text-[20px]'>Change Status</h1>

                <p className='font-inter text-[14px] text-gray-700'>
                    You have selected{' '}
                    <span className='font-semibold text-black'>
                        {selectedCount} {selectedCount === 1 ? 'transaction' : 'transactions'}
                    </span>
                </p>

                <div>
                    <label className='block text-[14px] font-medium text-gray-800 mb-2'>
                        New Status
                    </label>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-3 outline-none font-inter text-[14px] bg-white focus:border-[#4E37FB] transition"
                    >
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="successful">Successful</option>
                        <option value="failed">Failed</option>
                    </select>
                </div>

                <div className="flex justify-center gap-[15px] mt-4">
                    <button
                        onClick={onClose}
                        className='h-[40px] w-[167px] border border-[#D0D5DD] rounded-[4px] flex items-center justify-center font-inter text-[14px] font-semibold text-gray-700 hover:bg-gray-50 transition'
                    >
                        Cancel
                    </button>

                    <button
                        onClick={handleConfirm}
                        className='h-[40px] w-[167px] bg-[#4E37FB] rounded-[4px] flex items-center justify-center font-inter text-[14px] text-white font-semibold hover:bg-[#3e2ce8] transition'
                    >
                        Confirm Change
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ChangestatusModal;