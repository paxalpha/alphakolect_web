"use client"
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import TransactionTable from '../../../../../../components/tables/transactions/Transactiontable';
import adminAPI from '../../../utilis/adminApi';

const Page = () => {
  // Fetch transactions from API
  const { data: transactionsData, isLoading } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: adminAPI.getAllTransactions,
  });

  const transactions = transactionsData?.data || [];

  return (
       <div className='w-[100%]'>
       <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
              <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
                <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Transactions</h1>
                <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>View and manage all transactions happening all through the platform.</p>
              </div>
            </div>

            <TransactionTable transactions={transactions} isLoading={isLoading} />
    </div>
  )
}

export default Page