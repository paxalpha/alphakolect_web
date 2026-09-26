"use client"
import React, { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import Pagination from '../../admin/pagination';

interface RoleMember {
  id: string | number;
  roleName?: string;
  name?: string;
  cantView?: string;
  canViewOnly?: string;
  canEdit?: string;
  permissions?: string[];
  lastUpdated?: string;
  updatedAt?: string;
  created?: string;
  createdAt?: string;
}

interface RolesTableProps {
  rolesData: RoleMember[];
  onOpenEditModal: (role: RoleMember) => void;
  onDeleteRole: (id: string | number) => void;
}

const RolesTable: React.FC<RolesTableProps> = ({ rolesData, onOpenEditModal, onDeleteRole }) => {
  const [openDropdownId, setOpenDropdownId] = useState<string | number | null>(null);


  const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
  const [currentPage, setCurrentPage] = useState<number>(1)

  const toggleDropdown = (id: string | number) => {
    setOpenDropdownId(openDropdownId === id ? null : id);
  };

  const handleEditClick = (role: RoleMember) => {
    onOpenEditModal(role);
  };


  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * entriesPerPage;
    const end = start + entriesPerPage;
    return rolesData.slice(start, end);
  }, [rolesData, currentPage, entriesPerPage]);

  const totalPages = Math.ceil(rolesData.length / entriesPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [rolesData.length]);

  const formatPermissions = (permissions: string[] | undefined, type: 'view' | 'edit') => {
    if (!permissions) return '0';
    if (type === 'view') {
      return permissions.filter(p => p.startsWith('view_')).length + ' items';
    }
    return permissions.filter(p => p.startsWith('edit_') || p.startsWith('create_') || p.startsWith('delete_') || p.startsWith('manage_')).length + ' items';
  };

  return (
    <div>
      <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm w-full relative'>

        {/* Table */}
        <div className='overflow-x-auto mt-4'>
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
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Role</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Can’t view</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Can view only</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Can edit</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                    <div className="flex items-center gap-[3px]">
                      Last updated
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="up" width={6} height={6} />
                        <Image src="/icons/downarr.svg" alt="down" width={6} height={6} />
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                    <div className="flex items-center gap-[3px]">
                      Date created
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="up" width={6} height={6} />
                        <Image src="/icons/downarr.svg" alt="down" width={6} height={6} />
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-2"></th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>

              <tbody className="border-b border-[#D9D4D4] w-full">
                {paginatedData.map((item) => (
                  <tr key={item.id} className="bg-white dark:bg-gray-900 transition-all border-b duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{item.id}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white capitalize">{item.roleName || item.name}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.cantView || '-'}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                      {item.canViewOnly || formatPermissions(item.permissions, 'view')}
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                      {item.canEdit || formatPermissions(item.permissions, 'edit')}
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                      {item.lastUpdated || (item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : 'N/A')}
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                      {item.created || (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A')}
                    </td>
                    <td className="px-3 py-4">
                      <Image
                        src="/icons/lucide_edit.svg"
                        alt="edit"
                        width={20}
                        height={20}
                        className="cursor-pointer hover:opacity-70"
                        onClick={() => handleEditClick(item)}
                      />
                    </td>
                    <td className="relative px-3 py-4">
                      <Image
                        src="/icons/dots.svg"
                        alt="more"
                        width={20}
                        height={20}
                        className="cursor-pointer"
                        onClick={() => toggleDropdown(item.id)}
                      />

                      {openDropdownId === item.id && (
                        <div className="absolute right-0 mt-1 bg-white shadow-lg rounded-md z-50">
                          <button 
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer bg-transparent border-none"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteRole(item.id);
                              setOpenDropdownId(null);
                            }}
                          >Delete</button>
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
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={rolesData.length}
            itemsPerPage={entriesPerPage}
          />
        </div>
      </div>
    </div>
  )
}

export default RolesTable;