"use client"
import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import VerificationsTable from '../../../../../../components/tables/verifications/VerificationsTable';
import VerificationDetailsModal from '../../../../../../components/tables/verifications/modals/VerificationDetailsModal';

const Page = () => {
  const queryClient = useQueryClient();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);

  const handleOpenDetails = (request: any) => {
    setSelectedRequest(request);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedRequest(null);
  };

  const handleActionComplete = () => {
    setRefreshTrigger(prev => prev + 1);
    queryClient.invalidateQueries({ queryKey: ['verifications'] });
  };

  return (
    <div className="space-y-6">
      <div className='flex flex-col gap-1'>
        <h1 className='font-inter font-bold leading-[32px] text-[24px] text-[#101828]'>Verifications</h1>
        <p className='leading-[24px] font-inter font-normal text-[#667085] text-[14px] '>Review and manage merchant wallet upgrade requests</p>
      </div>

      <VerificationsTable 
        onViewDetails={handleOpenDetails} 
        refreshTrigger={refreshTrigger}
      />

      <VerificationDetailsModal 
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        request={selectedRequest}
        onActionComplete={handleActionComplete}
      />
    </div>
  )
}

export default Page;
