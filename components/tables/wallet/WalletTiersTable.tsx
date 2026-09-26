"use client"
import React, { useState } from 'react'
import Image from 'next/image'
import { FaAngleDown, FaEdit, FaTrash } from 'react-icons/fa';
import { useQuery } from '@tanstack/react-query';
import Pagination from '../../admin/pagination';
import adminAPI from '@/app/admin/utilis/adminApi';

interface WalletTiersTableProps {
  onEdit?: (tier: any) => void;
  refreshTrigger?: number;
}

const WalletTiersTable = ({ onEdit, refreshTrigger }: WalletTiersTableProps) => {
  const [show, setShow] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
  const [currentPage, setCurrentPage] = useState<number>(1)

  // Fetch wallet tiers from API
  const { data: tiersData, isLoading, refetch } = useQuery({
    queryKey: ['walletTiers', refreshTrigger],
    queryFn: () => adminAPI.getWalletTiers(),
  });

  const allTiers = tiersData?.tiers || [];

  // Filter tiers based on search
  const filteredTiers = React.useMemo(() => {
    if (!searchQuery.trim()) return allTiers;
    
    const query = searchQuery.toLowerCase();
    return allTiers.filter((tier: any) =>
      tier.name.toLowerCase().includes(query) ||
      tier.level.toString().includes(query) ||
      tier.dailyLimit?.toLowerCase().includes(query) ||
      tier.maxBalance?.toLowerCase().includes(query)
    );
  }, [allTiers, searchQuery]);

  // Paginate
  const paginatedTiers = React.useMemo(() => {
    const start = (currentPage - 1) * entriesPerPage;
    const end = start + entriesPerPage;
    return filteredTiers.slice(start, end);
  }, [filteredTiers, currentPage, entriesPerPage]);

  const totalPages = Math.ceil(filteredTiers.length / entriesPerPage);

  const handleEdit = (tier: any) => {
    if (onEdit) {
      onEdit(tier);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this wallet tier?')) {
      try {
        await adminAPI.deleteWalletTier(id);
        refetch();
        alert('Wallet tier deleted successfully!');
      } catch (error) {
        console.error('Error deleting tier:', error);
        alert('Failed to delete tier');
      }
    }
  };

  return (
    <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm w-full mb-2 relative rounded-lg overflow-hidden'>
      <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px]'>
        <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
          <div className='w-full md:w-[200px]'>
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

        <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
          <div className="flex items-center h-[40px] w-full md:w-[350px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
            <Image src="/icons/search.png" alt="search" width={20} height={20} className="cursor-pointer" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="outline-none px-3 py-2 w-full text-sm bg-transparent"
            />
          </div>
        </div>
      </div>

      <div className='overflow-x-auto'>
        <table className="table-auto w-full whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-[#F2F4F7] dark:bg-gray-800">
            <tr className="h-[44px] text-left">
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider">Tier</th>
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider">Daily limit</th>
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider">Max balance</th>
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider">Requirements</th>
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider">Fee to pay</th>
              <th className="px-6 py-3 text-[12px] font-medium text-[#667085] uppercase tracking-wider"></th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#F2F4F7]">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-gray-500">Loading tiers...</td>
              </tr>
            ) : paginatedTiers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-gray-500">No wallet tiers found</td>
              </tr>
            ) : (
              paginatedTiers.map((tier: any) => (
                <tr key={tier.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-[14px] text-[#101828] font-medium">Tier {tier.level}</td>
                  <td className="px-6 py-4 text-[14px] text-[#667085]">{tier.name}</td>
                  <td className="px-6 py-4 text-[14px] text-[#667085]">{tier.dailyLimit || 'NO'}</td>
                  <td className="px-6 py-4 text-[14px] text-[#667085]">{tier.maxBalance || 'NO'}</td>
                  <td className="px-6 py-4 text-[14px] text-[#667085]">
                    <div className="flex flex-wrap gap-2 items-center">
                      {(tier.requirements || []).map((req: string, idx: number) => (
                        <div key={idx} className="flex items-center">
                          <span className="w-1 h-1 rounded-full bg-[#667085] mr-1.5" />
                          {req}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[14px] text-[#667085]">{tier.fee || 'NO'}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-3 text-sm">
                      <button 
                        onClick={() => handleEdit(tier)}
                        className="p-2 text-[#4E37FB] hover:bg-indigo-50 rounded-lg transition-colors border border-indigo-100"
                      >
                        <span className="text-xs font-semibold px-2">Edit</span>
                      </button>
                      <button 
                        onClick={() => handleDelete(tier.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
                      >
                        <FaTrash size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className='p-4 border-t border-[#F2F4F7]'>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredTiers.length}
          itemsPerPage={entriesPerPage}
        />
      </div>
    </div>
  )
}

export default WalletTiersTable;
