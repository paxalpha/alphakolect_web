"use client"
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Addpackage from '../../../../../../../components/tables/merchants/modals/Add&EditMerchantModal'
import ChangestatusModal from '../../../../../../../components/tables/merchants/modals/Changestatusmodal'
import { data } from "../../../../utilis/sidebarmenuitems";
import Transactions from '../../../../../../../components/tables/merchants/merchantdetailstabs/Transactions'
import Subscriptions_Billings from '../../../../../../../components/tables/merchants/merchantdetailstabs/Subscriptions&Billings'
import Logs_Audits from '../../../../../../../components/tables/merchants/merchantdetailstabs/Logs&Audits'
import { MerchantData } from '../../../../../../../interface/type';
import adminAPI from '../../../../utilis/adminApi';

const MerchantDetails = ({ paramid }: { paramid: string }) => {
  const queryClient = useQueryClient();

  // Fetch all merchants from API
  const { data: merchantsData, isLoading } = useQuery({
    queryKey: ['allMerchants'],
    queryFn: adminAPI.getAllMerchants,
  });

  // Transform and find the specific merchant
  const merchant = React.useMemo(() => {
    if (!merchantsData?.data) return null;
    
    const foundMerchant = merchantsData.data.find((m: any) => String(m.id) === paramid);
    if (!foundMerchant) return null;

    return {
      id: String(foundMerchant.id),
      customer: foundMerchant.businessName || foundMerchant.name || 'N/A',
      package: foundMerchant.planName || 'Free',
      no_of_agents: String(foundMerchant.agentCount || 0),
      no_of_customers: String(foundMerchant.customerCount || 0),
      status: foundMerchant.isVerified ? 'Active' : 'Inactive',
      created: new Date(foundMerchant.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
      method: foundMerchant.email || 'N/A',
    };
  }, [merchantsData, paramid]);

  const [activeTab, setActiveTab] = useState("transactions");
  const [modalopen, setModalopen] = useState(false);
  const [packag, setPackag] = useState<boolean>(false);
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantData | null>(null);
  const [selectedUser, setSelectedUser] = useState<MerchantData | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

 const handleAddOrUpdate = async (merchant: MerchantData, mode: "add" | "edit") => {
  try {
    if (mode === "edit") {
      await adminAPI.updateMerchant(Number(merchant.id), {
        businessName: merchant.customer,
        email: merchant.method,
      });
      queryClient.invalidateQueries({ queryKey: ['allMerchants'] });
      alert('Merchant updated successfully!');
    }
    setPackag(false);
  } catch (error) {
    console.error('Error updating merchant:', error);
    alert('Failed to update merchant');
  }
};


  const handleStatusChange = async (userId: string | string[], newStatus: string) => {
    try {
      const ids = Array.isArray(userId) ? userId : [userId];
      await Promise.all(
        ids.map(id => adminAPI.updateMerchantStatus(Number(id), newStatus))
      );
      queryClient.invalidateQueries({ queryKey: ['allMerchants'] });
      setSelectedUsers([]);
      setModalopen(false);
      alert('Merchant status updated successfully!');
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update merchant status. Please try again.');
    }
  };

  return (
    <div className='relative '>

      <div className='absolute inset-x-0 top-0 box-border max-w-screen flex items-center py-3 gap-2 px-5 bg-white -mt-[34px] -mx-4 md:-mx-5 border-b-[1px]'>
        <p>Merchants</p>
        <p className=''><Image src={"/icons/ChevronRightMed.svg"} alt="right" width={6} height={6} /></p>
        <p className='text-[#93979F] text-[12px]'>{paramid}</p>
      </div>


      <div className='pt-8'>

        <div className='flex items-center justify-between max-md:flex-col max-md:flex-wrap  max-md:items-start gap-1'>

          <div className=''>
            <h1 className='font-inter font-semibold text-[20px] leading-[32px] max-sm:text-[12px]'> {paramid}</h1>
          </div>

          <div className='flex items-center gap-4 mt-2 max-md:flex-wrap'>
            <button
              onClick={() => {
                setSelectedMerchant(merchant ?? null); 
                setPackag(true);               
              }}
               className='bg-[#E9E6FF] p-3 flex items-center gap-2'>
              <p className='font-inter font-semibold text-[14px] leading-[20px] text-[#4E37FB] max-sm:text-[12px]'>Edit details</p>
            </button>

            <button
              onClick={() => {
                setSelectedUser(merchant ?? null);
                setSelectedUsers(merchant ? [merchant.id] : []);
                setModalopen(true);
              }}
              className='bg-[#E9E6FF] p-3 flex items-center gap-2'
            >

              <p className='font-inter font-semibold text-[14px] leading-[20px] text-[#4E37FB] max-sm:text-[12px]'>Change status</p>
            </button>

            <div className=''>
              <Image src={"/icons/dots.svg"} alt="dot" width={24} height={24} />
            </div>
          </div>
        </div>


        <div className="bg-white shadow-lg mt-4">

          <div className=''>

            <div className='grid grid-cols-3 flex gap-4 px-5 py-8 max-sm:grid-cols-1'>
              <div className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>Organization_ID</p>
                <p className='text-[12px] font-inter '>{merchant?.id}</p>
              </div>

              <div className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>no_of_customers</p>
                <h1 className='font-inter text-[13px] leading-[24px] max-sm:text-[12px]'>{merchant?.no_of_customers}</h1>
              </div>

              <div className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>No_of_Agents</p>
                <h1 className='font-inter text-[13px] leading-[24px] max-sm:text-[12px]'>{merchant?.no_of_agents}</h1>
              </div>

              <div className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>Date_created</p>
                <h1 className='font-inter text-[13px] leading-[24px] max-sm:text-[12px]'>{merchant?.created}</h1>
              </div>

              <div className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>Plan</p>
                <h1 className='font-inter text-[13px] leading-[24px] max-sm:text-[12px]'>{merchant?.package}</h1>
              </div>

              <div className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>Status</p>
                <h1 className='font-inter text-[13px] leading-[24px] max-sm:text-[12px]'>{merchant?.status}</h1>
              </div>
            </div>
          </div>

          {/*<div  className=''>
                <p className='text-[#93979F] text-[12px] font-inter '>Organization_ID</p>
                <h1 className='font-inter text-[16px] leading-[24px]'>MRCH-1023ASDTIYUPIUYHSTYUHFG</h1>
              </div>*/}

        </div>

        <div className='bg-white shadow-lg mt-4 mb-2'>

          <div className="flex items-center flex-nowrap pt-5 border-b border-gray-300 overflow-x-auto whitespace-nowrap hide-scrollbar">
            {[
              { id: "transactions", label: "Transactions" },
              { id: "subscriptions", label: "Subscription & billings" },
              { id: "logs", label: "Logs & Audit Trail" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 relative font-inter px-6 pb-2 text-sm sm:text-base transition-all ${activeTab === tab.id
                  ? "font-semibold text-[#1E1E1E] text-base"
                  : "font-normal text-[#9E9E9E] text-base"
                  }`}
              >
                {tab.label}
                <span
                  className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-10/12 transition-all ${activeTab === tab.id ? "bg-[#4E37FB] h-[3px]" : ""}
                  `}
                />
              </button>
            ))}
          </div>

          <div className="overflow-x-auto mt-2">
            {activeTab === "transactions" && <Transactions merchantId={paramid} />}
            {activeTab === "subscriptions" && <Subscriptions_Billings merchantId={paramid} />}
            {activeTab === "logs" && <Logs_Audits merchantId={paramid} />}
          </div>

        </div>
      </div>
      <Addpackage
        packag={packag}
        onClose={() => setPackag(false)}
        mode="edit"
        merchant={selectedMerchant}
        onSubmitMerchant={handleAddOrUpdate}
      />



      {modalopen && (
        <ChangestatusModal
          modalopen={modalopen}
          onClose={() => {
            setModalopen(false);
            setSelectedUser(null);
          }}
          user={selectedUser}
          bulk={selectedUsers}
          onConfirm={(userId, newStatus) => {
            if (userId && newStatus) {
              handleStatusChange(userId, newStatus);
            }
          }}
        />
      )}

    </div>
  )
}

export default MerchantDetails;