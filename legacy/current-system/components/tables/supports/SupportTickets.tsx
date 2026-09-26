"use client"
import React, {useState} from 'react'
import Image from 'next/image'
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import adminAPI from '@/app/admin/utilis/adminApi';
import Pagination from '../../admin/pagination';
import { MerchantData } from '../../../interface/type';
import { FaAngleDown } from 'react-icons/fa';
import IssueDetailsModal from './modals/Supportticket';

const SupportTickets = () => {

     const { data: ticketsData, isLoading } = useQuery({
        queryKey: ['allTickets'],
        queryFn: adminAPI.getAllTickets
     });

     const [show, setShow] = useState<boolean>(false)
    
      const [filter, setFilter] = useState(false)

      const [modalopen, setModalopen] = useState(false);
      const [selectedTicket, setSelectedTicket] = useState<any>(null);

      const items = ticketsData?.data || [];

  return (
    <div>

         <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm w-full  relative'>
        
        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px] '>
           {/* ... header content ... */}
           {/* skipping unchanging parts for brevity */}
           <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
            {/* ... */}
             <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white  transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter &&
                <div className='fixed inset-0 z-50 flex  items-center justify-center bg-black/20'>
                 <div className='lg:w-[500px] sm:w-[400px] w-[90%] absolute  bg-white max-h-[90vh]  overflow-y-auto flex flex-col gap-[20px] p-[15px]'>
                    <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px] ">
                      <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                      <button className=' text-[14px] text-[#4E37FB] font-inter font-semibold'>Clear filters</button>
                    </div>
                    <div className='border-t-[1px] w-full'></div>
                    <div className="w-full flex flex-col gap-[20px]">
                      {/* ... Filter content ... */}
                    </div>
                    <div className='border-t-[1px] w-full '></div>
                    <div className='flex gap-[8px] justify-end items-end mb-1 '>
                      <button onClick={() => setFilter(!filter)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                        <p className='text-[14px] font-inter text-[#4E37FB] font-semibold' >Close</p>
                      </button>
                      <button className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[99px] rounded-[4px] items-center gap-[9px] justify-center'>
                        <p className='text-[14px] font-inter text-white font-medium'>Add filters</p>
                      </button>
                    </div>
                  </div>
                </div>}
            </div>

            <div className='w-[100%]  md:w-[185px] '>
              <select className="h-[40px] w-full outline-none leading-[24px] rounded-[4px] border border-[#D0D5DD] font-inter text-[14px] bg-white px-2 transition-all">
                <option value="10">Show 10 per row</option>
                <option value="15">Show 15 per row</option>
              </select>
            </div>
          </div>

          <div className='flex flex-wrap gap-[10px] md:gap-[20px] w-full md:w-auto'>
             <div className='relative w-full md:w-auto'>
              <button onClick={() => setShow(!show)} className='bg-[#FAF9FF] h-[40px] cursor-pointer w-[105px] flex items-center justify-center gap-[7px] rounded-[4px]'>
                <p className='text-[#4E37FB] font-medium text-[14px]'>Export</p>
                <FaAngleDown className="w-[16px] h-[16px] text-[#4E37FB] my-[auto] " />
              </button>
              {show && <div onClick={() => setShow(!show)} className='absolute w-[90vw] max-w-[150px] min-w-[90px] md:w-[105px] bg-white rounded-[4px] shadow-lg'>
                 <p className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">Pending</p>
                 <p className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Open</p>
                 {/* ... */}
              </div>}
            </div>
            
             <div className="flex items-center h-[40px] w-full md:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
              <input type="text" placeholder="Search" className="outline-none px-3 py-2 w-full text-sm" />
            </div>
          </div>
        </div>

        {/*table*/}
        <div className='overflow-x-auto '>
          <div className='overflow-auto w-full'>
            <table className="table-auto w-full whitespace-nowrap  ">
              <thead className="bg-gray-50 border-b border-[#D9D4D4] dark:bg-gray-900 dark:text-white">
                <tr className="h-[40px] text-left">
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Ticket ID</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Merchant Name</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Issue Category</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Details</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white ">Last updated</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Created Date</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Status</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] "></th>
                </tr>
              </thead>

              <tbody className="border-b border-[#D9D4D4] w-full">
                {isLoading ? <tr><td colSpan={8} className="text-center py-4">Loading...</td></tr> : 
                 items.length === 0 ? <tr><td colSpan={8} className="text-center py-4">No tickets found</td></tr> :
                 items.map((item: any) => (
                  <tr key={item.id} className="bg-white dark:bg-gray-900  transition-all border-b duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                        {item.ticketId}
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.merchant?.businessName || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white ">{item.category}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.subject}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{new Date(item.updatedAt).toLocaleDateString()}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{new Date(item.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                        <span className={`px-2 py-1 rounded text-xs ${item.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {item.status}
                        </span>
                    </td>
                    <td className="px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer dark:text-white">
                      <div onClick={() => { setSelectedTicket(item); setModalopen(true); }} className='px-1 text-center border border-[#4E37FB] rounded cursor-pointer'>
                        <span className='font-inter text-sm text-[#4E37FB]'>View</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className='border-t-[1px] w-full mt-[20px]'></div>
          <Pagination 
            currentPage={1}
            totalPages={1}
            onPageChange={() => {}}
            totalItems={items.length}
            itemsPerPage={10}
          />
        </div>

      </div>

      {selectedTicket && (
          <IssueDetailsModal 
            isOpen={modalopen} 
            onClose={() => setModalopen(false)} 
            issue={{
                id: selectedTicket.ticketId,
                merchantName: selectedTicket.merchant?.businessName || 'Unknown',
                category: selectedTicket.category,
                status: selectedTicket.status,
                messages: [] // Detailed messages will be fetched inside the modal if implemented, or we can fetch details here before opening.
                // Assuming modal can handle basic info or fetches its own messages.
            }}
        />
      )}

    </div>
  )
}

export default SupportTickets