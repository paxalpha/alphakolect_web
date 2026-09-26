"use client"
import React, { useState, useMemo } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa';
import Pagination from '../../admin/pagination';

interface TransactionTableProps {
  transactions?: any[];
  isLoading?: boolean;
}

const TransactionTable = ({ transactions = [], isLoading = false }: TransactionTableProps) => {
    const [show, setShow] = useState<boolean>(false)
    const [filter, setFilter] = useState(false)
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState<string>('')
    const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
    const [currentPage, setCurrentPage] = useState<number>(1)

    const [selectedMerchant, setSelectedMerchant] = useState<string>('')
    const [selectedTypes, setSelectedTypes] = useState<string[]>([])
    const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])

    // Transform API data to match table format
    const tableData = useMemo(() => {
        return transactions.map((t: any) => ({
            id: t.id || '',
            type: t.type || 'N/A',
            merchant: t.Merchant?.businessName || t.merchantName || 'Unknown',
            merchantId: t.merchantId || '',
            amount: t.amount || 0,
            currency: t.currency || 'NGN',
            status: t.status || 'pending',
            created: new Date(t.createdAt || t.date || Date.now()).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            }),
        }));
    }, [transactions]);

    const filteredData = useMemo(() => {
        let result = [...tableData];

        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            result = result.filter(item =>
                item.id.toLowerCase().includes(lowerQuery) ||
                item.merchant.toLowerCase().includes(lowerQuery) ||
                item.type.toLowerCase().includes(lowerQuery)
            );
        }

        if (selectedMerchant) {
            result = result.filter(item => item.merchant === selectedMerchant);
        }

        if (selectedTypes.length > 0) {
            result = result.filter(item => selectedTypes.includes(item.type));
        }

        if (selectedStatuses.length > 0) {
            result = result.filter(item => selectedStatuses.includes(item.status));
        }

        return result;
    }, [tableData, searchQuery, selectedMerchant, selectedTypes, selectedStatuses]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * entriesPerPage;
        const end = start + entriesPerPage;
        return filteredData.slice(start, end);
    }, [filteredData, currentPage, entriesPerPage]);

    const totalPages = Math.ceil(filteredData.length / entriesPerPage);

    const handleSelectUser = (userId: string) => {
        setSelectedUsers((prev) =>
            prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
        );
    };

    const toggleDropdown = (id: string) => {
        setOpenDropdownId(openDropdownId === id ? null : id);
    };

    // Get unique merchants for filter
    const uniqueMerchants = useMemo(() => {
        return Array.from(new Set(tableData.map(t => t.merchant)));
    }, [tableData]);

    // Get unique types for filter
    const uniqueTypes = useMemo(() => {
        return Array.from(new Set(tableData.map(t => t.type)));
    }, [tableData]);

    return (
        <div>
            <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm mt-[25px] w-full mb-2 relative'>

                <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px]'>

                    <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>

                        <div className='relative w-full md:w-auto'>
                            <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white transition-all'>
                                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                                <p className='font-medium text-[14px]'>Filter</p>
                            </button>

                            {filter &&
                                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
                                    <div className='lg:w-[500px] sm:w-[400px] w-[90%] absolute bg-white max-h-[90vh] overflow-y-auto flex flex-col gap-[20px] p-[15px]'>

                                        <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px]">
                                            <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                                            <button onClick={() => {
                                                setSelectedMerchant(''); setSelectedTypes([]); setSelectedStatuses([]);
                                            }} className='text-[14px] text-[#4E37FB] font-inter font-semibold'>Clear filters</button>
                                        </div>

                                        <div className='border-t-[1px] w-full'></div>

                                        <div className="w-full flex flex-col gap-[20px]">
                                            <div>
                                                <p className='mb-2 font-inter font-medium text-[14px] leading-[20px]'>Merchant</p>
                                                <select value={selectedMerchant} onChange={(e) => setSelectedMerchant(e.target.value)} className="h-[40px] w-full outline-none leading-[24px] rounded-[4px] border border-[#D0D5DD] font-inter text-[14px] bg-white px-2 transition-all">
                                                    <option value="">All Merchants</option>
                                                    {uniqueMerchants.map(merchant => (
                                                        <option key={merchant} value={merchant}>{merchant}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div>
                                                <p className='mb-2 font-inter font-medium text-[14px] leading-[20px]'>Type</p>
                                                <div className='flex flex-wrap gap-[10px] max-md:flex-col'>
                                                    {uniqueTypes.map(type => (
                                                        <div key={type} className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedTypes.includes(type)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setSelectedTypes(prev => [...prev, type]);
                                                                    } else {
                                                                        setSelectedTypes(prev => prev.filter(t => t !== type));
                                                                    }
                                                                }}
                                                            />
                                                            {type}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div>
                                                <p className='mb-2 font-inter font-medium text-[14px] leading-[20px]'>Status</p>
                                                <div className='flex flex-wrap gap-[10px] max-md:flex-col'>
                                                    {['pending', 'completed', 'failed', 'approved'].map(status => (
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
                            <Image src="/icons/search.png" alt="search" width={20} height={20} className="cursor-pointer" />
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
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Transaction ID</th>
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Type</th>
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Merchant</th>
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Amount</th>
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Status</th>
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] dark:text-white">Date</th>
                                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]"></th>
                                </tr>
                            </thead>

                            <tbody className="border-b border-[#D9D4D4] w-full">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                                            Loading transactions...
                                        </td>
                                    </tr>
                                ) : paginatedData.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                                            No transactions found
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedData.map((item) => (
                                        <tr key={item.id} className="bg-white dark:bg-gray-900 transition-all border-b duration-500 hover:bg-gray-50">
                                            <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                                                {item.id}
                                            </td>
                                            <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.type}</td>
                                            <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.merchant}</td>
                                            <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">
                                                {item.currency} {item.amount.toLocaleString()}
                                            </td>
                                            <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white capitalize">
                                                <span className={`px-2 py-1 rounded text-xs ${
                                                    item.status === 'completed' || item.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                    item.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-red-100 text-red-800'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal dark:text-white">{item.created}</td>
                                            <td className="relative px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer">
                                                <Image src="/icons/dots.svg" alt="dots" width={20} height={20} onClick={() => toggleDropdown(item.id)} />

                                                {openDropdownId === item.id && (
                                                    <div className="absolute right-0 mt-1 bg-white shadow-lg rounded-md z-50">
                                                        <p className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Export</p>
                                                        <p className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">View Details</p>
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
                        totalItems={filteredData.length}
                        itemsPerPage={entriesPerPage}
                    />
                </div>
            </div>
        </div>
    )
}

export default TransactionTable;