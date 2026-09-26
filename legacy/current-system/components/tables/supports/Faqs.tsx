"use client"
import React, { useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query';
import adminAPI from '@/app/admin/utilis/adminApi';
import Pagination from '../../admin/pagination';
import { MerchantData } from '../../../interface/type';
import { FaAngleDown } from 'react-icons/fa';
import Link from 'next/link';
import { FaPlus } from 'react-icons/fa'
import AddEditFaqs from './modals/AddEditFaq';
import Managecategory from './modals/Managecategories';

const Faqs = () => {

       const { data: faqsData, isLoading, refetch } = useQuery({
        queryKey: ['allFaqs'],
        queryFn: adminAPI.getAllFaqs
     });

  const [packag, setPackag] = useState<boolean>(false)

  const [show, setShow] = useState<boolean>(false)

  const [filter, setFilter] = useState(false)

  const [mode, setMode] = useState<"add" | "edit">("add");

  const [selectedFaq, setSelectedFaq] = useState<any | null>(null);

  const [category, setCategory] = useState<boolean>(false);

  const items = faqsData?.data || [];

  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // ... handlers ...

  const toggleDropdown = (id: string) => {
    setOpenDropdownId(openDropdownId === id ? null : id);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this FAQ?')) {
        try {
            await adminAPI.deleteFaq(id);
            refetch();
        } catch (error) {
            console.error("Failed to delete FAQ", error);
            alert("Failed to delete FAQ");
        }
    }
  };

  return (
    <div>

      <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm mt-[25px] w-full  relative'>

        <div className=" flex flex-wrap items-center justify-between px-[10px] md:px-[20px] max-md:flex-col max-sm:gap-2">
           {/* ... header ... */}
           {/* Not changing much here */}
           <h1 className='font-inter font-semibold text-[20px]'>Frequently asked questions</h1>

          <div className='flex gap-[10px] items-end mt-4 md:mt-0 w-full md:w-auto'>
            {/* ... */}
             <div className='flex items-center gap-4 max-md:flex-col w-full'>
              <button onClick={() => setCategory(true)} className='flex border h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'>
                <p className='text-[14px] font-inter font-medium'>Manage categories</p>
              </button>

              <button onClick={() => {
                                setMode("add");
                                setSelectedFaq(null);
                                setPackag(true);}} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-full md:w-[160px] rounded-[4px] items-center gap-[9px] justify-center'>
                <FaPlus className='text-white font-normal w-[12px]' />
                <p className='text-[14px] font-inter text-white font-medium'>Add FAQ</p>
              </button>
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px] '>
            {/* ... Filters ... */}
            {/* Skipping deep filter structure for brevity, they are fine */}
            <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white  transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>
              {filter &&
                <div className='fixed inset-0 z-50 flex  items-center justify-center bg-black/20'>
                  {/* ... filter content ... */}
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
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Question</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Answer</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Category</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Created Date</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Status</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] "></th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] "></th>
                </tr>
              </thead>

              <tbody className="border-b border-[#D9D4D4] w-full">
                {isLoading ? <tr><td colSpan={7} className="text-center py-4">Loading...</td></tr> :
                 items.length === 0 ? <tr><td colSpan={7} className="text-center py-4">No FAQs found</td></tr> :
                 items.map((item: any) => (
                  <tr key={item.id} className="bg-white dark:bg-gray-900  transition-all border-b duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal "><div className="flex items-center gap-2">
                       <span className="flex items-center gap-[3px] text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white truncate max-w-[200px]">
                        {item.question}
                      </span>
                    </div></td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white truncate max-w-[200px]">{item.answer}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white ">{item.category}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{new Date(item.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                         <span className={`px-2 py-1 rounded text-xs ${item.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {item.isActive ? 'Published' : 'Draft'}
                        </span>
                    </td>
                    <td className="px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer dark:text-white">
                      <div className='px-1 text-center border border-[#4E37FB]'>
                        <button onClick={() => {
                                setMode("edit");
                                setSelectedFaq(item);
                                setPackag(true);}} className='font-inter text-sm text-[#4E37FB]'>View</button>
                      </div>
                    </td>
                    <td className="relative px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer ">
                      <Image src="/icons/dots.svg" alt="dots" width={20} height={20} onClick={() => toggleDropdown(item.id)} />

                      {openDropdownId === item.id && (
                        <div className="absolute right-0  mt-1 bg-white shadow-lg rounded-md z-50">
                          <button onClick={() => {
                                setMode("edit");
                                setSelectedFaq(item);
                                setPackag(true);
                            }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900">Edit</button>
                          <button onClick={() => handleDelete(item.id)} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-900">Delete</button>
                        </div>
                      )}

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


      <AddEditFaqs
        packag={packag}
        onClose={() => setPackag(false)}
        mode={mode}
        merchant={selectedFaq}
      />

      <Managecategory
      category={category}
      onClose={() => setCategory(false)}
       />

    </div>
  )
}

export default Faqs;