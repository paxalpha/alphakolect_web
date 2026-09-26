
"use client"
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import Audittable from '../../../../../../components/tables/auditslogs/Audittable';
import adminAPI from '../../../utilis/adminApi';



const Page = () => {
  // Fetch audit logs from API
  const { data: logsData, isLoading } = useQuery({
    queryKey: ['allAdminLogs'],
    queryFn: adminAPI.getAllAdminLogs,
  });

  const logs = logsData?.data || [];

  return (

    <div>

      <div className=''>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Audit log</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>Manages all actions of all admin users on the platform.</p>
        </div>
      </div>

      <Audittable logs={logs} isLoading={isLoading} />


    </div>
  )
}

export default Page;