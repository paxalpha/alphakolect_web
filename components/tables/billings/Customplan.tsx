"use client"
import React, { useState } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa';
import { useQuery } from '@tanstack/react-query';
import Pagination from '../../admin/pagination';
import adminAPI from '@/app/admin/utilis/adminApi';

interface CustomplanProps {
  onEdit?: (plan: any) => void;
  refreshTrigger?: number;
}

const Customplan = ({ onEdit, refreshTrigger }: CustomplanProps) => {
  const [show, setShow] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Fetch custom plans from API
  const { data: plansData, isLoading, refetch } = useQuery({
    queryKey: ['customPlans', refreshTrigger],
    queryFn: async () => {
      const response = await adminAPI.getAllPlans();
      // Filter for custom plans only
      return {
        ...response,
        data: response.data.filter((plan: any) => plan.type === 'custom')
      };
    },
  });

  const allPlans = plansData?.data || [];

  // Filter plans based on search
  const filteredPlans = React.useMemo(() => {
    if (!searchQuery.trim()) return allPlans;
    
    const query = searchQuery.toLowerCase();
    return allPlans.filter((plan: any) =>
      plan.name.toLowerCase().includes(query) ||
      plan.description?.toLowerCase().includes(query) ||
      plan.Merchant?.businessName?.toLowerCase().includes(query)
    );
  }, [allPlans, searchQuery]);

  // Paginate
  const paginatedPlans = React.useMemo(() => {
    const start = (currentPage - 1) * entriesPerPage;
    const end = start + entriesPerPage;
    return filteredPlans.slice(start, end);
  }, [filteredPlans, currentPage, entriesPerPage]);

  const totalPages = Math.ceil(filteredPlans.length / entriesPerPage);

  const toggleDropdown = (id: string) => {
    setOpenDropdownId(openDropdownId === id ? null : id);
  };

  const handleEdit = (plan: any) => {
    if (onEdit) {
      onEdit(plan);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this custom plan?')) {
      try {
        await adminAPI.deletePlan(id);
        refetch();
        alert('Custom plan deleted successfully!');
      } catch (error) {
        console.error('Error deleting plan:', error);
        alert('Failed to delete plan');
      }
    }
  };

  return (
    <div>
      <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm w-full mb-2 relative'>

        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px]'>

          <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
            <div className='w-[100%] md:w-[185px]'>
              <select
                value={entriesPerPage}
                onChange={(e) => setEntriesPerPage(Number(e.target.value))}
                className="h-[40px] w-full outline-none leading-[24px] rounded-[4px] border border-[#D0D5DD] font-inter text-[14px] bg-white px-2 transition-all"
              >
                <option value={10}>Show 10 per row</option>
                <option value={15}>Show 15 per row</option>
                <option value={20}>Show 20 per row</option>
              </select>
            </div>
          </div>

          <div className='flex flex-wrap gap-[10px] md:gap-[20px] w-full md:w-auto'>
            <div className='relative w-full md:w-auto'>
              <button onClick={() => setShow(!show)} className='bg-[#FAF9FF] h-[40px] cursor-pointer w-[105px] flex items-center justify-center gap-[7px] rounded-[4px]'>
                <p className='text-[#4E37FB] font-medium text-[14px]'>Export</p>
                <FaAngleDown className="w-[16px] h-[16px] text-[#4E37FB] my-[auto]" />
              </button>

              {show && (
                <div onClick={() => setShow(false)} className='absolute w-[90vw] max-w-[150px] min-w-[90px] md:w-[105px] bg-white rounded-[4px] shadow-lg z-10'>
                  <p className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">PDF</p>
                  <p className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">CSV</p>
                </div>
              )}
            </div>

            <div className="flex items-center h-[40px] w-full md:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="search" width={20} height={20} className="cursor-pointer" />
              <input
                type="text"
                placeholder="Search custom plans..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className='overflow-x-auto'>
          <div className='overflow-auto w-full'>
            <table className="table-auto w-full whitespace-nowrap">
              <thead className="bg-gray-50 border-b border-[#D9D4D4] dark:bg-gray-900 dark:text-white">
                <tr className="h-[40px] text-left">
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Plan Name</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Merchant</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Billing Cycle</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Pricing</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Max Agents</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Max Customers</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Status</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]"></th>
                </tr>
              </thead>

              <tbody className="border-b border-[#D9D4D4] w-full">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-gray-500">
                      Loading custom plans...
                    </td>
                  </tr>
                ) : paginatedPlans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-gray-500">
                      No custom plans found. Create a custom plan for a specific merchant.
                    </td>
                  </tr>
                ) : (
                  paginatedPlans.map((plan: any) => (
                    <tr key={plan.id} className="bg-white dark:bg-gray-900 transition-all border-b duration-500 hover:bg-gray-50">
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-semibold dark:text-white">
                        {plan.name}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                        {plan.Merchant?.businessName || plan.merchant?.businessName || 'N/A'}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white capitalize">
                        {plan.billingCycle || plan.billing_cycle}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                        {plan.currency} {Number(plan.pricing).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                        {plan.maxAgents || plan.max_agents || 'Unlimited'}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                        {plan.maxCustomers || plan.max_customers || 'Unlimited'}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                        <span className={`px-2 py-1 rounded text-xs ${plan.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {plan.status}
                        </span>
                      </td>
                      <td className="relative px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer">
                        <Image src="/icons/dots.svg" alt="dots" width={20} height={20} onClick={() => toggleDropdown(plan.id.toString())} />

                        {openDropdownId === plan.id.toString() && (
                          <div className="absolute right-0 mt-1 bg-white shadow-lg rounded-md z-50">
                            <p onClick={() => handleEdit(plan)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">Edit</p>
                            <p onClick={() => handleDelete(plan.id)} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 cursor-pointer">Delete</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className='border-t-[1px] w-full mt-[20px]'></div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredPlans.length}
            itemsPerPage={entriesPerPage}
          />
        </div>
      </div>
    </div>
  )
}

export default Customplan;