import React, { useState } from 'react'
import { MerchantData } from '../../../../interface/type';

interface ChangestatusmodalProps {
  modalopen: boolean;
  onClose: () => void;
  user: MerchantData | null;
  bulk: string[];
  onConfirm: (userId: string | string[], newStatus: string) => void;
}

function ChangestatusModal({ modalopen, onClose, user, bulk, onConfirm }: ChangestatusmodalProps) {
  const [status, setStatus] = useState(user?.status || 'Active');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
    
      const idsToUpdate = bulk.length > 0 ? bulk : (user?.id ? [user.id] : []);
      
      if (idsToUpdate.length === 0) {
        console.error('No users selected');
        return;
      }

      
      onConfirm(idsToUpdate, status);

     
      await new Promise(resolve => setTimeout(resolve, 300));

      onClose();
    } catch (error) {
      console.error('Error changing status:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!modalopen) return null;

  const selectedCount = bulk.length > 0 ? bulk.length : 1;
  const displayText = bulk.length > 0 ? `${bulk.length} Merchants` : user?.id || 'Merchant';

  return (
    <div>
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
        <div className='lg:w-[400px] w-[90%] absolute bg-white rounded-[12px] flex flex-col gap-[20px] p-[24px]'>
          <h1 className='font-inter font-semibold'>Change Status</h1>
          <p className='font-inter text-[14px]'>
            You have selected <span className='font-semibold'>{displayText}</span>
          </p>

          <div className=''>
            <h1 className='mb-2 font-inter font-medium text-sm'>Status</h1>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border w-full p-2 rounded border-[#D0D5DD] outline-none h-[45px]"
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="flex justify-center mt-2 gap-[15px]">
            <button 
              onClick={onClose} 
              disabled={isSubmitting}
              className='bg-white flex h-[40px] cursor-pointer w-[167px] border border-[#D0D5DD] rounded-[4px] items-center gap-[9px] justify-center disabled:opacity-50'
            >
              <p className='text-[14px] font-inter font-semibold'>Close</p>
            </button>

            <button 
              onClick={handleSubmit} 
              disabled={isSubmitting}
              className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[167px] rounded-[4px] items-center gap-[9px] justify-center disabled:opacity-70'
            >
              <p className='text-[14px] font-inter text-white font-semibold'>
                {isSubmitting ? 'Updating...' : 'Confirm'}
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChangestatusModal;
