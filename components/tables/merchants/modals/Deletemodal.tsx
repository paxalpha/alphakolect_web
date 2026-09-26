import { MerchantData } from "../../../../interface/type";
import { useState } from "react";

interface prop {
  user: MerchantData | null;
  onClose: () => void;
  bulk: string[];
  bulker: (bulk: string[]) => void;
  onConfirm: (userId: string | string[]) => void;
}

const DeleteUserModal = ({ user, onClose, bulk, bulker, onConfirm }: prop) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const Delete = async () => {
    setIsDeleting(true);
    
    try {
     
      const idsToDelete = bulk.length > 0 ? bulk : (user?.id ? [user.id] : []);
      
      if (idsToDelete.length === 0) {
        console.error('No users selected for deletion');
        return;
      }

      onConfirm(idsToDelete);

      
      await new Promise(resolve => setTimeout(resolve, 300));

      bulker([]);
      onClose();
    } catch (error) {
      console.error('Error deleting:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedCount = bulk.length > 0 ? bulk.length : 1;
  const displayText = bulk.length > 0 ? `${bulk.length} records` : user?.id || '1 record';

  return (
    <>
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
        <div className='lg:w-[400px] absolute w-[90%] h-[220px] bg-white rounded-[12px] flex flex-col gap-[20px] p-[24px]'>
          <h1 className='font-inter font-semibold'>Are you sure?</h1>

          <p className='font-inter text-[14px]'>
            Are you sure you want to delete {displayText}? This cannot be undone after confirmation.
          </p>

          <div className="flex justify-center gap-[15px]">
            <button 
              onClick={onClose} 
              disabled={isDeleting}
              className='bg-white flex h-[40px] cursor-pointer w-[167px] border border-[#D0D5DD] rounded-[8px] items-center gap-[9px] justify-center disabled:opacity-50'
            >
              <p className='text-[14px] font-inter font-semibold'>Cancel</p>
            </button>

            <button 
              onClick={Delete} 
              disabled={isDeleting}
              className='bg-red-500 flex h-[40px] cursor-pointer w-[167px] rounded-[8px] items-center gap-[9px] justify-center disabled:opacity-70'
            >
              <p className='text-[14px] font-inter text-white font-semibold'>
                {isDeleting ? 'Deleting...' : 'Confirm'}
              </p>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DeleteUserModal;
