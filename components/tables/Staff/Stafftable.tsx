"use client"
import React, { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa';
import Pagination from '../../admin/pagination';

interface StaffMember {
  id: string | number;
  fullName?: string;
  name?: string;
  email: string;
  phoneNumber: string;
  role?: string;
  AdminRole?: { id: number; name: string };
  status: 'active' | 'inactive';
  created?: string;
  createdAt?: string;
}

type StaffFormData = {
  full_name: string;
  Email: string;
  phone_number: string;
  role: string;
}

interface StaffTableProps {
  staffData: StaffMember[];
  onOpenEditModal: (staff: StaffMember) => void;
  onAddStaff?: (data: StaffFormData) => void;
  onUpdateStaff?: (data: StaffFormData, id: string) => void;
}

const StaffTable: React.FC<StaffTableProps> = ({ 
  staffData, 
  onOpenEditModal,
  onAddStaff,
  onUpdateStaff
}) => {
  const [show, setShow] = useState<boolean>(false)
  const [filter, setFilter] = useState(false)

  const [searchQuery, setSearchQuery] = useState<string>('')
  const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])

  const filteredData = useMemo(() => {
    let result = [...staffData];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        (item.fullName || item.name || '').toLowerCase().includes(query) ||
        item.email.toLowerCase().includes(query) ||
        item.phoneNumber.includes(query) ||
        (item.role || item.AdminRole?.name || '').toLowerCase().includes(query) ||
        String(item.id).toLowerCase().includes(query)
      );
    }

    if (selectedStatuses.length > 0) {
      result = result.filter(item => selectedStatuses.includes(item.status));
    }

    if (selectedRoles.length > 0) {
      result = result.filter(item => {
        const roleName = item.role || item.AdminRole?.name || '';
        return selectedRoles.includes(roleName);
      });
    }

    return result;
  }, [staffData, searchQuery, selectedStatuses, selectedRoles]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * entriesPerPage;
    const end = start + entriesPerPage;
    return filteredData.slice(start, end);
  }, [filteredData, currentPage, entriesPerPage]);

  const totalPages = Math.ceil(filteredData.length / entriesPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatuses, selectedRoles, entriesPerPage]);

  const handleEditClick = (staff: StaffMember) => {
    onOpenEditModal(staff); 
  };

  return (
    <div>
      <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm w-full relative'>

        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px]'>

          <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter &&
                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
                  <div className='lg:w-[500px] sm:w-[400px] w-[90%] absolute bg-white max-h-[90vh] overflow-y-auto flex flex-col gap-[20px] p-[15px]'>

                    <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px]">
                      <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                      <button
                        onClick={() => {
                          setSelectedStatuses([]);
                          setSelectedRoles([]);
                        }}
                        className='text-[14px] text-[#4E37FB] font-inter font-semibold'
                      >
                        Clear filters
                      </button>
                    </div>

                    <div className='border-t-[1px] w-full'></div>

                    <div className="w-full flex flex-col gap-[20px]">
                      <div>
                        <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Status</p>
                        <div className='flex flex-wrap gap-[10px]'>
                          {['active', 'inactive'].map(status => (
                            <div key={status} className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                              <input
                                type="checkbox"
                                checked={selectedStatuses.includes(status)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedStatuses(prev => [...prev, status]);
                                  } else {
                                    setSelectedStatuses(prev => prev.filter(s => s !== status));
                                  }
                                }}
                              />
                              {status.charAt(0).toUpperCase() + status.slice(1)}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Role</p>
                        <div className='flex flex-wrap gap-[10px]'>
                          {['Super Admin', 'Admin', 'Admin II', 'Admin III', 'Officer', 'Support Staff', 'Compliance Officer'].map(role => (
                            <div key={role} className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                              <input
                                type="checkbox"
                                checked={selectedRoles.includes(role)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRoles(prev => [...prev, role]);
                                  } else {
                                    setSelectedRoles(prev => prev.filter(r => r !== role));
                                  }
                                }}
                              />
                              {role}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className='border-t-[1px] w-full'></div>

                    <div className='flex gap-[8px] justify-end items-end mb-1'>
                      <button onClick={() => setFilter(false)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                        <p className='text-[14px] font-inter text-[#4E37FB] font-semibold'>Close</p>
                      </button>
                      <button onClick={() => setFilter(false)} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[99px] rounded-[4px] items-center gap-[9px] justify-center'>
                        <p className='text-[14px] font-inter text-white font-medium'>Apply</p>
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>

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
              <Image src="/icons/search.png" alt="search" width={20} height={20} />
              <input
                type="text"
                placeholder="Search"
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
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                    <div className="flex items-center gap-[3px]">
                      ID
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="up" width={6} height={6} />
                        <Image src="/icons/downarr.svg" alt="down" width={6} height={6} />
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Full name</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Email</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Phone number</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Role</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                    <div className="flex items-center gap-[3px]">Date created
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="up" width={6} height={6} />
                        <Image src="/icons/downarr.svg" alt="down" width={6} height={6} />
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Status</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]"></th>
                </tr>
              </thead>

              <tbody className="border-b border-[#D9D4D4] w-full">
                {paginatedData.map((item) => (
                  <tr key={item.id} className="bg-white dark:bg-gray-900 transition-all border-b duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{item.id}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white capitalize">{item.fullName || item.name}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.email}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.phoneNumber}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.role || item.AdminRole?.name || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                      {item.created || (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A')}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${item.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <Image
                        src="/icons/lucide_edit.svg"
                        alt="edit"
                        width={18}
                        height={18}
                        className="cursor-pointer hover:opacity-70 transition"
                        onClick={() => handleEditClick(item)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className='border-t-[1px] w-full mt-[20px]'></div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredData.length}
            itemsPerPage={entriesPerPage}
          />
        </div>
      </div>
    </div>
  )
}

export default StaffTable;