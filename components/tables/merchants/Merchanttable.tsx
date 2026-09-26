import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { FaAngleDown } from 'react-icons/fa';
import Link from 'next/link';
import ActionMenu from '../../menus/menu';
import Pagination from '../../admin/pagination';
import { MerchantData } from '../../../interface/type';
import ChangestatusModal from './modals/Changestatusmodal';
import ChangePasswordModal from './modals/Resetpasswordmodal';
import DeleteUserModal from './modals/Deletemodal';

interface props {
  data: MerchantData[];
  setData: React.Dispatch<React.SetStateAction<MerchantData[]>>;
  packag: boolean;
  setpackage: (packag: boolean) => void;
  setMode: (mode: "add" | "edit") => void;
  setSelectedMerchant: (merchant: MerchantData | null) => void;
  onStatusChange?: (userId: string | string[], newStatus: string) => Promise<void>;
  onPasswordReset?: (userId: string, newPassword: string) => Promise<void>;
  onDelete?: (userId: string | string[]) => Promise<void>;
}

const MerchantTable = ({ data, setData, packag, setpackage, setMode, setSelectedMerchant, onStatusChange, onPasswordReset, onDelete }: props) => {

  const allData = data;
const setAllData = setData;    
  const [filteredData, setFilteredData] = useState<MerchantData[]>([]);
  const [displayData, setDisplayData] = useState<MerchantData[]>([]);

  const [show, setShow] = useState<boolean>(false);
  const [filter, setFilter] = useState(false);
  const [modalopen, setModalopen] = useState(false);
  const [reset, setReset] = useState<boolean>(false);
  const [deletee, setDeletee] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<MerchantData | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

 
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  
  useEffect(() => {
    setFilteredData(allData);
  }, [allData]);

  
  useEffect(() => {
    let result = [...allData];

    if (statusFilters.length > 0) {
      result = result.filter(item => statusFilters.includes(item.status));
    }

  
    if (typeFilters.length > 0) {
      result = result.filter(item => {
        const packageLower = item.package.toLowerCase();
        return typeFilters.some(type => packageLower.includes(type.toLowerCase()));
      });
    }

  
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.id.toLowerCase().includes(query) ||
        item.package.toLowerCase().includes(query) ||
        item.customer.toLowerCase().includes(query) ||
        item.no_of_agents.toLowerCase().includes(query) ||
        item.no_of_customers.toLowerCase().includes(query)
      );
    }

    setFilteredData(result);
    setCurrentPage(1);
  }, [statusFilters, typeFilters, searchQuery, allData]);

  // Apply pagination
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayData(filteredData.slice(startIndex, endIndex));
  }, [filteredData, currentPage, itemsPerPage]);

  // Filter handlers
  const handleStatusFilter = (status: string) => {
    setStatusFilters(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const handleTypeFilter = (type: string) => {
    setTypeFilters(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const clearFilters = () => {
    setStatusFilters([]);
    setTypeFilters([]);
  };

  const applyFilters = () => {
    setFilter(false);
  };

  // CRUD Operations
  const handleSelectUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleEdit = (menu: MerchantData) => {
    console.log(menu);
    setpackage(true);
    setMode("edit");
    setSelectedMerchant(menu);
  };

  const resetClick = (menu: MerchantData) => {
    console.log(menu);
    setSelectedUser(menu);
    setReset(true);
  };

  const statusClick = (menu: MerchantData) => {
    setSelectedUser(menu);
    setModalopen(true);
  };

  const deleteClick = (menu: MerchantData) => {
    setSelectedUser(menu);
    setDeletee(true);
  };


  const handleStatusChange = (userId: string | string[], newStatus: string) => {
    setAllData(prev =>
      prev.map(item =>
        (Array.isArray(userId) ? userId.includes(item.id) : item.id === userId)
          ? { ...item, status: newStatus }
          : item
      )
    );
    setSelectedUsers([]);
  };

  const handleDelete = (userId: string | string[]) => {
    setAllData(prev =>
      prev.filter(item =>
        Array.isArray(userId) ? !userId.includes(item.id) : item.id !== userId
      )
    );
    setSelectedUsers([]);
  };

  
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  return (
    <div>
      <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm mt-[25px] w-full mb-2 relative'>

        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px] '>

          <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter &&
                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
                  <div className='lg:w-[500px] sm:w-[400px] w-[90%] absolute bg-white max-h-[90vh] overflow-y-auto flex flex-col gap-[20px] p-[15px]'>

                    <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px] ">
                      <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                      <button onClick={clearFilters} className='text-[14px] text-[#4E37FB] font-inter font-semibold'>Clear filters</button>
                    </div>

                    <div className='border-t-[1px] w-full'></div>

                    <div className="w-full flex flex-col gap-[20px]">

                      <div>
                        <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Status</p>
                        <div className='flex lg:items-center gap-[10px] max-md:flex-col'>
                          <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                            <input
                              type="checkbox"
                              name='active'
                              checked={statusFilters.includes('active')}
                              onChange={() => handleStatusFilter('active')}
                            />
                            Active
                          </div>

                          <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                            <input
                              type="checkbox"
                              name='inactive'
                              checked={statusFilters.includes('inactive')}
                              onChange={() => handleStatusFilter('inactive')}
                            />
                            Inactive
                          </div>
                        </div>
                      </div>

                      <div className="">
                        <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Type</p>
                        <div className='flex lg:items-center gap-[10px] max-md:flex-col'>

                          <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                            <input
                              type="checkbox"
                              name='beta'
                              checked={typeFilters.includes('Free')}
                              onChange={() => handleTypeFilter('Free')}
                            />
                            Free
                          </div>

                          <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                            <input
                              type="checkbox"
                              name='gamma'
                              checked={typeFilters.includes('Basic')}
                              onChange={() => handleTypeFilter('Basic')}
                            />
                            Basic
                          </div>

                          <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                            <input
                              type="checkbox"
                              name='delta'
                              checked={typeFilters.includes('Pro')}
                              onChange={() => handleTypeFilter('Pro')}
                            />
                            Pro
                          </div>
                          <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                            <input
                              type="checkbox"
                              name='delta'
                              checked={typeFilters.includes('Custom')}
                              onChange={() => handleTypeFilter('Custom')}
                            />
                            Custom
                          </div>
                        </div>
                      </div>

                    </div>

                    <div className='border-t-[1px] w-full '></div>

                    <div className='flex gap-[8px] justify-end items-end mb-1 '>
                      <button onClick={() => setFilter(!filter)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                        <p className='text-[14px] font-inter text-[#4E37FB] font-semibold' >Close</p>
                      </button>

                      <button onClick={applyFilters} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[99px] rounded-[4px] items-center gap-[9px] justify-center'>
                        <p className='text-[14px] font-inter text-white font-medium'>Add filters</p>
                      </button>
                    </div>
                  </div>
                </div>}
            </div>

            <div className='w-[100%] md:w-[185px] '>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="w-full h-[40px] outline-none leading-[24px] rounded-[4px] border border-[#D0D5DD] font-inter text-[14px] bg-white px-2 transition-all"
              >
                <option value="10">Show 10 per row</option>
                <option value="15">Show 15 per row</option>
              </select>
            </div>

          </div>

          <div className='flex flex-wrap gap-[10px] md:gap-[20px] w-full md:w-auto'>

            <div className='flex items-center gap-5 max-md:w-full'>
              <div className='w-full md:w-auto mb-2 md:mb-0'>
                <button
                  disabled={selectedUsers.length === 0}
                  onClick={() => setModalopen(!modalopen)}
                  className={`bg-[#4E37FB] h-[40px] w-full md:w-[118px] flex items-center justify-center gap-[7px] rounded-[4px] ${selectedUsers.length === 0 ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <p className='text-white font-medium text-[14px]'>Change Status</p>
                </button>
              </div>

              <button
                disabled={selectedUsers.length === 0}
                onClick={() => setDeletee(true)}
                className={`${selectedUsers.length === 0 ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <Image src="/icons/delete.svg" alt='delete' width={40} height={40} />
              </button>
            </div>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setShow(!show)} className='bg-[#FAF9FF] h-[40px] cursor-pointer w-[105px] flex items-center justify-center gap-[7px] rounded-[4px]'>
                <p className='text-[#4E37FB] font-medium text-[14px]'>Export</p>
                <FaAngleDown className="w-[16px] h-[16px] text-[#4E37FB] my-[auto] " />
              </button>

              {show && <div onClick={() => setShow(!show)} className='absolute w-[90vw] max-w-[150px] min-w-[90px] md:w-[105px] bg-white rounded-[4px] shadow-lg'>
                <p className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">PDF</p>
                <p className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">CSV</p>
              </div>}
            </div>

            <div className="flex items-center h-[40px] w-full md:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
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

        {/*table*/}
        <div className='overflow-x-auto '>
          <div className='overflow-auto w-full'>
            <table className="table-auto w-full whitespace-nowrap  ">
              <thead className="bg-gray-50 border-b border-[#D9D4D4] dark:bg-gray-900 dark:text-white">
                <tr className="h-[40px] text-left">
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="w-5 h-5 border border-gray-300 rounded-md hover:border-indigo-500 hover:bg-indigo-100 checked:bg-indigo-100"
                      />
                      <span className="flex items-center gap-[3px] text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                        Organization ID
                        <div className="flex flex-col gap-[1px] shrink-0">
                          <Image src="/icons/uparr.svg" alt="uparrow" width={6} height={6} className="shrink-0" />
                          <Image src="/icons/downarr.svg" alt="uparrow" width={6} height={6} className="shrink-0" />
                        </div>
                      </span>
                    </div>
                  </th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Name</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">No of Agents</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                    <div className="flex items-center gap-[3px]">
                      No of Customers
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="uparrow" width={6} height={6} className="shrink-0" />
                        <Image src="/icons/downarr.svg" alt="uparrow" width={6} height={6} className="shrink-0" />
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white ">
                    <div className="flex items-center gap-[3px]">
                      Present Plan
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="uparrow" width={6} height={6} className="shrink-0" />
                        <Image src="/icons/downarr.svg" alt="uparrow" width={6} height={6} className="shrink-0" />
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Status</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Date Created</th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white"></th>
                  <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] "></th>
                </tr>
              </thead>

              <tbody className="border-b border-[#D9D4D4] w-full">
                {displayData.map((item) => (
                  <tr key={item.id} className="bg-white dark:bg-gray-900 transition-all border-b duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(item.id)}
                          onChange={() => handleSelectUser(item.id)}
                          className="w-5 h-5 border border-gray-300 rounded-md hover:border-indigo-500 hover:bg-indigo-100 checked:bg-indigo-100"
                        />
                        <span className="flex items-center gap-[3px] text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">
                          {item.id}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.customer}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white ">{item.no_of_agents}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.no_of_customers}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.package}</td>
                    <td className={`px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white ${item.status === "active" ? "text-green-500" : "text-[#FF0000]"}`}>{item.status}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.created}</td>
                    <td className="px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer dark:text-white">
                      <div className='px-1 text-center border border-[#4E37FB]'>
                        <Link href={`/admin/dashboard/merchants/${item.id}`}><p className='font-inter text-sm text-[#4E37FB]'>View</p></Link>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer ">
                      <ActionMenu
                        rowId={item.id}
                        onEditDetails={() => handleEdit(item)}
                        reset={() => resetClick(item)}
                        status={() => statusClick(item)}
                        Delete={() => deleteClick(item)}
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
            itemsPerPage={itemsPerPage}
          />

        </div>

      </div>

      {deletee && (
        <DeleteUserModal
          onClose={() => {
            setDeletee(false);
            setSelectedUser(null);
          }}
          user={selectedUser}
          bulk={selectedUsers}
          bulker={setSelectedUsers}
          onConfirm={(userId) => {
            if (userId) {
              handleDelete(userId);
            }
          }}
        />
      )}

      {reset && (
        <ChangePasswordModal
          onClose={() => {
            setReset(false);
            setSelectedUser(null);
          }}
          user={selectedUser}
        />
      )}

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
  );
};

export default MerchantTable;