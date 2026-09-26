
"use client"
import React, { useState } from 'react'
import { FaPlus } from 'react-icons/fa'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import MerchantTable from '../../../../../../components/tables/merchants/Merchanttable'
import Addpackage from '../../../../../../components/tables/merchants/modals/Add&EditMerchantModal'
import { MerchantData } from '../../../../../../interface/type'
import adminAPI from '../../../utilis/adminApi'

const Page = () => {
  const [packag, setPackag] = useState<boolean>(false)
  const [mode, setMode] = useState<"add" | "edit">("add");
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantData | null>(null);
  const queryClient = useQueryClient();

  // Fetch merchants from API
  const { data: merchantsData, isLoading, error } = useQuery({
    queryKey: ['allMerchants'],
    queryFn: adminAPI.getAllMerchants,
  });

  // Transform API data to match MerchantData interface
  const merchants: MerchantData[] = React.useMemo(() => {
    if (!merchantsData?.data) return [];
    
    return merchantsData.data.map((merchant: any) => ({
      id: String(merchant.id),
      customer: merchant.businessName || merchant.name || 'N/A',
      package: merchant.planName || 'Free',
      no_of_agents: String(merchant.agentCount || 0),
      no_of_customers: String(merchant.customerCount || 0),
      status: merchant.isVerified ? 'Active' : 'Inactive',
      created: new Date(merchant.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
      method: merchant.email || 'N/A',
    }));
  }, [merchantsData]);

  const handleAddOrUpdate = async (merchant: MerchantData, mode: "add" | "edit") => {
    try {
      if (mode === "edit") {
        // Update merchant via API
        await adminAPI.updateMerchant(Number(merchant.id), {
          businessName: merchant.customer,
          email: merchant.method,
        });
      }
      // Note: Add functionality would need a separate endpoint
      
      // Invalidate and refetch merchants after add/update
      queryClient.invalidateQueries({ queryKey: ['allMerchants'] });
      setPackag(false);
    } catch (error) {
      console.error('Error updating merchant:', error);
      alert('Failed to update merchant');
    }
  };

  const handleStatusChange = async (userId: string | string[], newStatus: string) => {
    try {
      const ids = Array.isArray(userId) ? userId : [userId];
      
      // Update each merchant's status
      await Promise.all(
        ids.map(id => adminAPI.updateMerchantStatus(Number(id), newStatus))
      );
      
      // Refresh merchants list
      queryClient.invalidateQueries({ queryKey: ['allMerchants'] });
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update merchant status');
    }
  };

  const handlePasswordReset = async (userId: string, newPassword: string) => {
    try {
      await adminAPI.resetMerchantPassword(Number(userId), newPassword);
      alert('Password reset successfully');
    } catch (error) {
      console.error('Error resetting password:', error);
      alert('Failed to reset password');
    }
  };

  const handleDelete = async (userId: string | string[]) => {
    try {
      const ids = Array.isArray(userId) ? userId : [userId];
      
      // Delete each merchant
      await Promise.all(
        ids.map(id => adminAPI.deleteMerchant(Number(id)))
      );
      
      // Refresh merchants list
      queryClient.invalidateQueries({ queryKey: ['allMerchants'] });
    } catch (error) {
      console.error('Error deleting merchant:', error);
      alert('Failed to delete merchant');
    }
  };



  return (
    <div className='w-[100%]'>

      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Merchants</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>View and mange all merchants that are on your platform.</p>
        </div>

        <div className='flex items-end mt-4 md:mt-0 w-full md:w-auto' onClick={() => {
          setMode("add");
          setSelectedMerchant(null);
          setPackag(true);
        }}>
          <button className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'>
            <FaPlus className='text-white font-normal w-[12px]' />
            <p className='text-[14px] font-inter text-white font-medium'>Add merchant</p>
          </button>
        </div>

      </div>

      <Addpackage
        packag={packag}
        onClose={() => setPackag(false)}
        mode={mode}
        merchant={selectedMerchant}
        onSubmitMerchant={handleAddOrUpdate}
      />

      <MerchantTable
        data={isLoading ? [] : merchants}
        setData={() => {}} // Data is managed by React Query now
        packag={packag}
        setpackage={setPackag}
        setMode={setMode}
        setSelectedMerchant={setSelectedMerchant}
        onStatusChange={handleStatusChange}
        onPasswordReset={handlePasswordReset}
        onDelete={handleDelete}
      />


    </div>
  )
}

export default Page;