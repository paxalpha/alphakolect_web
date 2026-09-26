"use client"
import React, { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa';
import Pagination from '../../admin/pagination';

interface AuditLog {
    id: number;
    adminStaffId: number;
    action: string;
    details: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    updatedAt: string;
    AdminStaff?: {
        id: number;
        name: string;
        email: string;
        role: string;
    };
}

interface AudittableProps {
    logs?: AuditLog[];
    isLoading?: boolean;
}

function Audittable({ logs = [], isLoading = false }: AudittableProps) {
    const [show, setShow] = useState<boolean>(false)
    const [filter, setFilter] = useState(false)

    const [selectedMerchant, setSelectedMerchant] = useState<string>('')
    const [selectedAction, setSelectedAction] = useState<string>('')
    const [selectedUser, setSelectedUser] = useState<string>('')
    const [dateRangeDays, setDateRangeDays] = useState<string>('10')
    const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
    const [currentPage, setCurrentPage] = useState<number>(1)
    const [searchQuery, setSearchQuery] = useState<string>('')

    // Extract unique values from real data
    const uniqueActions = useMemo(() => 
        Array.from(new Set(logs.map(item => item.action))), 
        [logs]
    );
    
    const uniqueUsers = useMemo(() => 
        Array.from(new Set(logs.map(item => item.AdminStaff?.name).filter(Boolean))), 
        [logs]
    );


    const filteredData = useMemo(() => {
        let result = [...logs];

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(item =>
                item.details?.toLowerCase().includes(query) ||
                item.action.toLowerCase().includes(query) ||
                item.AdminStaff?.name?.toLowerCase().includes(query) ||
                item.AdminStaff?.email?.toLowerCase().includes(query)
            );
        }

        if (selectedAction) {
            result = result.filter(item => item.action === selectedAction);
        }
        if (selectedUser) {
            result = result.filter(item => item.AdminStaff?.name === selectedUser);
        }

        // Date range filter
        if (dateRangeDays) {
            const days = parseInt(dateRangeDays);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            
            result = result.filter(item => new Date(item.createdAt) >= cutoffDate);
        }

        return result;
    }, [logs, searchQuery, selectedAction, selectedUser, dateRangeDays]);


    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * entriesPerPage;
        const end = start + entriesPerPage;
        return filteredData.slice(start, end);
    }, [filteredData, currentPage, entriesPerPage]);

    const totalPages = Math.ceil(filteredData.length / entriesPerPage);


    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, selectedAction, selectedUser, entriesPerPage, dateRangeDays]);

    return (
        <div>
            <div className='bg-white dark:bg-gray-900 dark:text-white mt-6 shadow-sm w-full relative'>

                <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px]'>

                    <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>

                        <div className='relative w-full md:w-auto'>
                            <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white transition-all'>
                                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} />
                                <p className='font-medium text-[14px]'>Filter</p>
                            </button>

                            {filter &&
                                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
                                    <div className='lg:w-[500px] sm:w-[400px] w-[90%] max-h-[90vh] overflow-y-auto absolute bg-white flex flex-col gap-[20px] p-[15px]'>

                                        <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px]">
                                            <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                                            <button
                                                onClick={() => {
                                                    setSelectedMerchant('');
                                                    setSelectedAction('');
                                                    setSelectedUser('');
                                                }}
                                                className='text-[14px] text-[#4E37FB] font-inter font-semibold'
                                            >
                                                Clear filters
                                            </button>
                                        </div>

                                        <div className='border-t-[1px] w-full'></div>

                                        <div className="w-full flex flex-col gap-[20px]">


                                            <div>
                                                <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Action Type</p>
                                                <select
                                                    value={selectedAction}
                                                    onChange={(e) => setSelectedAction(e.target.value)}
                                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]"
                                                >
                                                    <option value="">All Actions</option>
                                                    {uniqueActions.map(action => (
                                                        <option key={action} value={action}>{action}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div>
                                                <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Users</p>
                                                <select
                                                    value={selectedUser}
                                                    onChange={(e) => setSelectedUser(e.target.value)}
                                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]"
                                                >
                                                    <option value="">All Users</option>
                                                    {uniqueUsers.map(user => (
                                                        <option key={user} value={user}>{user}</option>
                                                    ))}
                                                </select>
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

                        <div className='w-[100%] md:w-[180px]'>
                            <select
                                value={dateRangeDays}
                                onChange={(e) => setDateRangeDays(e.target.value)}
                                className="h-[40px] w-full outline-none leading-[24px] rounded-[4px] border border-[#D0D5DD] font-inter text-[14px] bg-white px-2 transition-all"
                            >
                                <option value="10">Last 10 days</option>
                                <option value="20">Last 20 days</option>
                                <option value="30">Last 30 days</option>
                            </select>
                        </div>


                    </div>
                </div>


                <div className='overflow-x-auto'>
                    <div className='overflow-auto w-full'>
                        <table className="table-auto w-full whitespace-nowrap dark:border dark:border-gray-700">
                            <thead className="bg-gray-50 border-b border-[#D9D4D4] dark:bg-gray-900">
                                <tr className="h-[40px] text-left leading-[18px] text-[12px] font-lato font-normal text-[#141414] dark:text-white">
                                    <th className="px-5 py-2">Date & Time</th>
                                    <th className="px-5 py-2">User</th>
                                    <th className="px-5 py-2">Merchant</th>
                                    <th className="px-5 py-2">Action</th>
                                    <th className="px-5 py-2">
                                        <div className="flex items-center gap-[3px]">
                                            Details
                                            <div className='flex flex-col gap-[1px]'>
                                                <Image src="/icons/uparr.svg" alt="up" width={6} height={6} className="shrink-0" />
                                                <Image src="/icons/downarr.svg" alt="down" width={6} height={6} className="shrink-0" />
                                            </div>
                                        </div>
                                    </th>
                                </tr>
                            </thead>

                            <tbody className='w-full bg-white dark:bg-gray-900'>
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                                            Loading audit logs...
                                        </td>
                                    </tr>
                                ) : paginatedData.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                                            No audit logs found
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedData.map((item) => {
                                        const userName = item.AdminStaff?.name || 'Unknown User';
                                        const userInitials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                                        const formattedDate = new Date(item.createdAt).toLocaleDateString('en-US', { 
                                            day: 'numeric', 
                                            month: 'short', 
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        });
                                        
                                        return (
                                            <tr key={item.id} className="text-[14px] text-gray-600 dark:text-white transition-all duration-500 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-[#D9D4D4] dark:border dark:border-gray-700 font-lato font-normal leading-[20px]">
                                                <td className="px-5 py-4">{formattedDate}</td>
                                                <td className="px-5 py-4">
                                                    <div className="flex gap-1">
                                                        <div className="p-2 rounded-full bg-[#E9E6FF] text-[#4E37FB] cursor-pointer flex items-center justify-center text-sm font-bold">
                                                            {userInitials}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <h1 className="font-lato text-[14px] leading-[20px]">{userName}</h1>
                                                            <p className="text-[14px] font-lato">{item.AdminStaff?.role || 'N/A'}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4">N/A</td>
                                                <td className="px-5 py-4">{item.action}</td>
                                                <td className="px-5 py-4">
                                                    <div className="flex flex-col">
                                                        <h1 className="font-lato text-[14px] leading-[20px]">{item.details || 'No details'}</h1>
                                                        {item.ipAddress && (
                                                            <p className="text-[14px] font-lato text-[#432AFB]">IP: {item.ipAddress}</p>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
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

export default Audittable