"use client"
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Dashboardcards from "../../../../components/dashboard/cards";
import { FaPlus } from 'react-icons/fa'
import Charts from "../../../../components/dashboard/charts";
import Image from "next/image"
import Addpackage from "../../../../components/tables/merchants/modals/Add&EditMerchantModal";
import { MerchantData } from "../../../../interface/type";
import adminAPI from "../utilis/adminApi";


export default function Home() {

  const [packag, setPackag] = useState<boolean>(false)
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantData | null>(null);
  const [merchants, setMerchants] = useState<MerchantData[]>([]);
  
  // Fetch super admin stats
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['superStats'],
    queryFn: adminAPI.getSuperStats,
  });

  // Fetch all activities
  const { data: activitiesData, isLoading: activitiesLoading } = useQuery({
    queryKey: ['allActivities'],
    queryFn: adminAPI.getAllActivities,
  });
  
  const handleAddOrUpdate = (merchant: MerchantData, mode: "add" | "edit") => {

    const stored: MerchantData[] = JSON.parse(localStorage.getItem("merchants") || "[]");

    if (mode === "add") {
      stored.push(merchant);
    } else {
      const idx = stored.findIndex(m => m.id === merchant.id);
      if (idx !== -1) stored[idx] = merchant;
    }

    localStorage.setItem("merchants", JSON.stringify(stored));
  };




  return (
    <div className="w-full">

      <div className='flex flex-wrap  justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className="font-inter font-semibold leading-[32px] text-[24px]">Dashboard</h1>
          <p className="font-inter font-medium text-[#717680] text-[14px] leading-[24px]" >Monitor overview of all activities across merchants and platform</p>
        </div>

        <div className='flex items-end md:mt-0 w-full md:w-auto'>
          <button onClick={() => {
            setSelectedMerchant(null);
            setPackag(true);
          }} className='bg-[#4E37FB] dark:bg-gray-900 dark:border dark:border-gray-700 flex h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'>
            <FaPlus className='text-white font-normal w-[12px]' />
            <p className='text-[14px] font-inter text-white font-medium'>Add merchant</p>
          </button>
        </div>

      </div>

      <div className="">
        {/* dashboard cards */}
        <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-6 ">
          <Dashboardcards 
            label="Total merchants" 
            count={statsLoading ? "..." : statsData?.data?.totalMerchants || 0} 
            icon="/icons/cardss.svg" 
          />
          <Dashboardcards 
            label="Active merchants" 
            count={statsLoading ? "..." : statsData?.data?.activeMerchants || 0} 
            icon="/icons/cardss.svg" 
          />
          <Dashboardcards 
            label="Inactive merchants" 
            count={statsLoading ? "..." : statsData?.data?.inactiveMerchants || 0} 
            icon="/icons/cardss.svg" 
          />
          <Dashboardcards 
            label="New merchants (30D)" 
            count={statsLoading ? "..." : statsData?.data?.newMerchants || 0} 
            icon="/icons/cardss.svg" 
          />
        </div>

        <Charts />

        {/* recent activities */}
        <div className="mt-5 bg-white mb-7 dark:bg-gray-900 dark:text-white">

          <div className="flex justify-between p-5">
            <h1 className="font-inter font-semibold leading-[24px] text-[18px]">Recent activities</h1>
            <p className="font-inter font-semibold text-[14px] leading-[24px] text-[#4E37FB] dark:text-white">View all</p>
          </div>

          {/* desktop table stacked row */}
          <div className='overflow-auto w-full '>
            <table className="table-auto w-full whitespace-nowrap dark:border dark:border-gray-700 ">
              <thead className="bg-gray-50 border-b border-[#D9D4D4] dark:bg-gray-900 ">
                <tr className="h-[40px] text-left leading-[18px] text-[12px] font-lato font-normal text-[#141414] dark:text-white">
                  <th className="px-5 py-2 ">
                    Date & Time
                  </th>
                  <th className="px-5 py-2">User</th>
                  <th className="px-5 py-2 ">Action</th>
                  <th className="px-5 py-2 ">
                    <div className="flex items-center gap-[3px]">
                      Details
                      <div className='flex flex-col gap-[1px]'>
                        <Image src="/icons/uparr.svg" alt="uparrow" width={7} height={7} className="shrink-0" />
                        <Image src="/icons/downarr.svg" alt="uparrow" width={7} height={7} className="shrink-0" />
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody className=' w-full bg-white dark:bg-gray-900'>
                {activitiesLoading ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-gray-500">
                      Loading activities...
                    </td>
                  </tr>
                ) : !activitiesData?.data || activitiesData.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-gray-500">
                      No recent activities found
                    </td>
                  </tr>
                ) : (
                  activitiesData.data.slice(0, 10).map((activity: any, index: number) => {
                    const date = new Date(activity.date || activity.createdAt);
                    const formattedDate = date.toLocaleDateString('en-US', { 
                      day: 'numeric', 
                      month: 'short', 
                      year: 'numeric' 
                    });
                    const formattedTime = date.toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    });
                    
                    // Get initials from person name
                    const getInitials = (name: string) => {
                      if (!name) return '??';
                      const parts = name.trim().split(' ');
                      if (parts.length >= 2) {
                        return (parts[0][0] + parts[1][0]).toUpperCase();
                      }
                      return name.substring(0, 2).toUpperCase();
                    };

                    return (
                      <tr 
                        key={activity.id || index} 
                        className="text-[14px] text-gray-600 dark:text-white transition-all duration-500 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-[#D9D4D4] dark:border dark:border-gray-700 font-lato font-normal leading-[20px]"
                      >
                        <td className="px-5 py-4">{formattedDate} - {formattedTime}</td>
                        <td className="px-5 py-4">
                          <div className="flex gap-1">
                            <div className="p-2 rounded-full bg-[#E9E6FF] text-[#4E37FB] cursor-pointer flex items-center justify-center text-purple text-sm font-bold">
                              {getInitials(activity.personName || 'Unknown')}
                            </div>
                            <div className="flex flex-col">
                              <h1 className="font-lato text-[14px] leading-[20px]">
                                {activity.personName || 'Unknown User'}
                              </h1>
                              <p className="text-[14px] font-lato capitalize">
                                {activity.person || 'User'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">{activity.action || 'No action'}</td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col">
                            <h1 className="font-lato text-[14px] leading-[20px]">
                              {activity.details || 'No details available'}
                            </h1>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

        </div>
      </div>

      <Addpackage
        packag={packag}
        onClose={() => setPackag(false)}
        mode="add"
        merchant={selectedMerchant}
        onSubmitMerchant={handleAddOrUpdate}
      />

    </div>
  );
}
