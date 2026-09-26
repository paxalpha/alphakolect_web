"use client"
import React, { useState } from 'react'
import { FaPlus } from 'react-icons/fa'
import { useQueryClient } from '@tanstack/react-query'
import WalletTiersTable from '../../../../../../components/tables/wallet/WalletTiersTable';
import AddEditTierModal from '../../../../../../components/tables/wallet/modals/AddEditTierModal';

const Page = () => {
  const queryClient = useQueryClient();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedTier, setSelectedTier] = useState<any>(null);

  const handleOpenAdd = () => {
    setModalMode('add');
    setSelectedTier(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (tier: any) => {
    setModalMode('edit');
    setSelectedTier(tier);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTier(null);
    setRefreshTrigger(prev => prev + 1);
    queryClient.invalidateQueries({ queryKey: ['walletTiers'] });
  };

  return (
    <div className="space-y-6">
      <div className='flex flex-wrap justify-between items-center gap-4'>
        <div className='flex flex-col gap-1'>
          <h1 className='font-inter font-bold leading-[32px] text-[24px] text-[#101828]'>Wallet parameters</h1>
          <p className='leading-[24px] font-inter font-normal text-[#667085] text-[14px] '>View and mange all merchants wallet verification settings</p>
        </div>

        <button 
          onClick={handleOpenAdd} 
          className='bg-[#4E37FB] flex h-[40px] px-6 cursor-pointer rounded-[4px] items-center gap-[9px] justify-center hover:bg-[#3d2dd8] transition-all transform active:scale-95 shadow-sm'
        >
          <FaPlus className='text-white font-normal w-[12px]' />
          <p className='text-[14px] font-inter text-white font-medium'>Add Tier</p>
        </button>
      </div>

      <WalletTiersTable 
        onEdit={handleOpenEdit} 
        refreshTrigger={refreshTrigger}
      />

      <AddEditTierModal 
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        mode={modalMode}
        tierData={selectedTier}
      />
    </div>
  )
}

export default Page;
