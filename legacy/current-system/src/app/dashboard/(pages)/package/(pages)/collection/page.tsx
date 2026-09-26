"use client"
import React, { useState, useEffect, useMemo } from 'react'
import { FaPlus } from 'react-icons/fa'
import { FaAngleDown } from 'react-icons/fa';
import Image from 'next/image';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup
} from "@/components/ui/select"
import Addpackage from './Addpackage';
import Editpackage from './Editpackage';
import { fetchPackages, deletePackage } from '../../../../../../../services/api';

// ── Export helpers ──────────────────────────────────────────
function exportTableToPDF(title: string, headers: string[], rows: (string | number)[][], rowCount: number) {
  const now = new Date().toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' });
  const tableRows = rows.map(row =>
    `<tr>${row.map(cell => `<td>${cell ?? ''}</td>`).join('')}</tr>`
  ).join('');
  const html = `
    <div class="print-table-area">
      <div class="print-header">
        <div class="print-header-title">${title}</div>
        <div class="print-header-meta">Generated: ${now}<br/>Total records: ${rowCount}</div>
      </div>
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="print-footer">AlphaKolect &mdash; Confidential &mdash; ${now}</div>
    </div>`;
  let portal = document.getElementById('print-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'print-portal';
    document.body.appendChild(portal);
  }
  portal.innerHTML = html;
  window.print();
  setTimeout(() => { if (portal) portal.innerHTML = ''; }, 1000);
}

function exportToCSV(title: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const Page = () => {
  // Define Package interface
  interface Package {
    id: number;
    name: string;
    type: string;
    amount: number;
    seedAmount: number;
    seedType: string;
    period: number;
    collectionDays: string;
    duration: number;
    benefits: string[];
    description?: string;
    status: string;
    createdAt: string;
    packageCategory?: string;
  }

  // State for dynamic data
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: string } | null>(null);

  const [show, setShow] = useState<boolean>(false)
  const [packag, setPackag] = useState<boolean>(false)
  const [edit, setEdit] = useState(false)
  const [packageToEdit, setPackageToEdit] = useState(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [filter, setFilter] = useState(false);

  // Fetch data function
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // @ts-ignore
      const response = await fetchPackages('Collection');
      if (response.success) {
        setPackages(response.packages || []);
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
      setError('Failed to load packages. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    fetchData();
  }, []);

  // Handle rows per page change
  const handleRowsPerPageChange = (value: string) => {
    setRowsPerPage(Number(value));
    setCurrentPage(1);
  };

  // Handle search
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  // Handle sorting
  const requestSort = (key: string) => {
    let direction = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Get sort icon
  const getSortIcon = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) {
      return (
        <div className='flex flex-col gap-[1px]'>
          <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
          <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
        </div>
      );
    }
    return (
      <div className='flex flex-col gap-[1px]'>
        <Image 
          src={sortConfig.direction === 'asc' ? "/icons/uparr.svg" : "/icons/downarr.svg"} 
          alt="sort" 
          width={8} 
          height={8} 
          className="shrink-0" 
        />
      </div>
    );
  };

  // Filter and sort packages
  const filteredAndSortedPackages = useMemo(() => {
    let filteredPackages = [...packages];
    
    // Apply search filter and restrict to collection-related types only
    // This ensures Fixed Deposit, Target Saving, and Loan packages don't appear on this page
    filteredPackages = filteredPackages.filter(pkg => {
      const type = pkg.type;
      
      // Known collection types: Fixed, Flexible, Variable (per model)
      // Known loan types: Flat Rate, Percentage Rate (per Addloan.tsx)
      // Known investment types: Fixed Deposit, Target Saving (per Addinvestment.tsx)
      const isCollectionType = ['Fixed', 'Flexible', 'Variable'].includes(type);
      const isLoanType = ['Flat Rate', 'Percentage Rate'].includes(type) || pkg.packageCategory === 'Loan';
      const isInvestmentType = ['Fixed Deposit', 'Target Saving'].includes(type) || pkg.packageCategory === 'Investment';
      
      // We only want collection types and must exclude any loan or investment packages
      if (!isCollectionType || isLoanType || isInvestmentType) {
        return false;
      }

      if (statusFilter && pkg.status !== statusFilter) return false;
      if (typeFilter && pkg.type !== typeFilter) return false;

      if (searchTerm) {
        return pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
               pkg.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
               pkg.seedType?.toLowerCase().includes(searchTerm.toLowerCase());
      }
      return true;
    });
    
    // Apply sorting
    if (sortConfig) {
      filteredPackages.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof Package];
        let bValue: any = b[sortConfig.key as keyof Package];

        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'asc' 
            ? aValue.localeCompare(bValue) 
            : bValue.localeCompare(aValue);
        }

        return 0;
      });
    }
    
    return filteredPackages;
  }, [packages, searchTerm, sortConfig, statusFilter, typeFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedPackages.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const currentPackages = filteredAndSortedPackages.slice(startIndex, startIndex + rowsPerPage);

  // Handle page change
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Handle edit package
  const handleEditPackage = (pkg: any) => {
    ;(window as any).__pkgToEdit = pkg
    setPackageToEdit(pkg);
    setEdit(true);
  };

  // ── Export handlers ───────────────────────────────────────
  const exportHeaders = ['ID', 'Name', 'Type', 'Seed Amount/Percentage', 'Seed Type', 'Period', 'Collection Days'];
  const getExportRows = () => filteredAndSortedPackages.map(pkg => [
    `PKG${String(pkg.id).padStart(5, '0')}`,
    pkg.name,
    pkg.type,
    pkg.type === 'Fixed' ? parseFloat(String(pkg.seedAmount)).toLocaleString() : `${parseFloat(String(pkg.seedAmount)).toLocaleString()}%`,
    pkg.seedType,
    pkg.period,
    pkg.collectionDays
  ]);

  const handleExportPDF = () => {
    setShow(false);
    exportTableToPDF('Collection Packages', exportHeaders, getExportRows(), filteredAndSortedPackages.length);
  };

  const handleExportCSV = () => {
    setShow(false);
    exportToCSV('Collection_Packages', exportHeaders, getExportRows());
  };

  // Handle delete package
  const handleDeletePackage = async (packageId: number) => {
    if (window.confirm('Are you sure you want to delete this package?')) {
      try {
        await deletePackage(packageId);
        await fetchData(); // Refresh the list
      } catch (error) {
        console.error('Error deleting package:', error);
        setError('Failed to delete package. Please try again.');
      }
    }
  };

  return (
    <div className='w-[100%]'>
      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
            <div className="ml-auto pl-3">
              <div className="-mx-1.5 -my-1.5">
                <button
                  onClick={() => setError(null)}
                  className="inline-flex bg-red-50 rounded-md p-1.5 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-red-50 focus:ring-red-600"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.400z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Collection packages</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>Create and manage collection packages.</p>
        </div>

        <div className='flex items-end mt-4 md:mt-0 w-full md:w-auto gap-2'>
          <button 
            onClick={fetchData}
            disabled={loading}
            className='bg-gray-600 flex h-[40px] cursor-pointer w-full md:w-auto px-4 rounded-[4px] items-center gap-[9px] justify-center'
          >
            <svg className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className='text-[14px] font-inter text-white font-medium'>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <button onClick={() => setPackag(true)} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'>
            <FaPlus className='text-white font-normal w-[12px]' />
            <p className='text-[14px] font-inter text-white font-medium'>Create package</p>
          </button>
        </div>

      </div>

      {packag && <Addpackage packag={packag} onClose={() => { setPackag(false); fetchData(); }} />}
      {edit && <Editpackage edit={edit} onClose={() => { setEdit(false); setPackageToEdit(null); fetchData(); }} />}

      <div className='bg-white shadow-sm mt-[25px] w-full relative'>

        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px] '>

          <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
            <Select onValueChange={handleRowsPerPageChange} value={String(rowsPerPage)}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder="Show 10 per row" />
              </SelectTrigger>
              <SelectContent className="w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="10" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]  ">Show 10 per row</SelectItem>
                  <SelectItem value="15" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">Show 15 per row</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white  transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter && (
                <div className='fixed md:absolute flex flex-col justify-center z-[100] left-0 right-0 md:left-auto md:right-auto top-0 md:top-auto mx-auto md:mx-0 w-[95%] md:w-[400px] lg:w-[510px] max-w-full md:max-w-[510px] min-w-[230px] md:min-w-[250px] mb-0 md:mb-8 bg-white rounded-b-[8px] md:rounded-[4px] shadow-lg md:p-0' >
                  <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px] mb-2 md:p-4">
                    <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                    <button 
                      onClick={() => {
                        setStatusFilter('');
                        setTypeFilter('');
                        setFilter(false);
                      }} 
                      className='underline text-[14px] text-[#4E37FB] font-inter font-semibold'
                    >
                      Clear filters
                    </button>
                  </div>
                  <div className='border-t-[1px] w-full mb-1'></div>
                  <div className="w-full p-4">
                    <p className='mb-1 font-inter font-semibold text-[14px] leading-[20px]'>Status</p>
                    <div className='flex lg:items-center gap-[10px] mb-6 max-md:flex-col'>
                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="checkbox" 
                          checked={statusFilter === 'Active'}
                          onChange={(e) => setStatusFilter(e.target.checked ? 'Active' : '')}
                          className='' 
                        />
                        Active
                      </div>
                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="checkbox" 
                          checked={statusFilter === 'Inactive'}
                          onChange={(e) => setStatusFilter(e.target.checked ? 'Inactive' : '')}
                          className='' 
                        />
                        Inactive
                      </div>
                    </div>

                    <div className="mb-6">
                      <p className='mb-1 font-inter font-semibold text-[14px] leading-[20px]'>Collection type</p>
                      <div className='relative w-full'>
                        <select 
                          className='w-full appearance-none h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]'
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value)}
                        >
                          <option value="">All types</option>
                          <option value="Fixed">Fixed</option>
                          <option value="Flexible">Flexible</option>
                          <option value="Variable">Variable</option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                          <FaAngleDown className="w-[16px] h-[16px] text-[#8E8E93]" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className='border-t-[1px] w-full mb-1'></div>
                  <div className='flex gap-[8px] justify-end items-end p-2 md:p-4 mb-2 '>
                    <button onClick={() => setFilter(!filter)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                      <p className='text-[14px] font-inter text-[#4E37FB] font-semibold' >Close</p>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className='flex flex-wrap gap-[10px] md:gap-[20px] w-full md:w-auto'>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setShow(!show)} className='bg-[#FAF9FF] h-[40px] cursor-pointer w-[105px] flex items-center justify-center gap-[7px] rounded-[4px]'>
                <p className='text-[#4E37FB] font-medium text-[14px]'>Export</p>
                <FaAngleDown className="w-[16px] h-[16px] text-[#4E37FB] my-[auto] " />
              </button>

              {show && <div className='absolute w-[90vw] max-w-[150px] min-w-[90px] md:w-[105px] bg-white rounded-[4px] shadow-lg z-50'>
                <p onClick={handleExportPDF} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">PDF</p>
                <p onClick={handleExportCSV} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">CSV</p>
              </div>}
            </div>

            {/* <Select >
        <SelectTrigger className="bg-[#FAF9FF] h-[40px] text-[#4E37FB] font-semibold text-[14px] outline-none border-none  cursor-pointer w-[105px]  rounded-[4px]">
          <SelectValue placeholder="Export"/>
        </SelectTrigger>
        <SelectContent className="w-[105px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
          <SelectGroup>
            <SelectItem value="10"  className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]  ">PDF</SelectItem>
            <SelectItem value="15" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">CSV</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>*/}

            <div className="flex items-center h-[40px] lg:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />

              <input
                type="text"
                placeholder="Search packages..."
                value={searchTerm}
                onChange={handleSearch}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>

          </div>
        </div>

         <div className='overflow-auto w-full'>
          <table className="table-auto w-full whitespace-nowrap hidden md:table">
            <thead className="bg-gray-50 border-b border-[#D9D4D4]">
              <tr className="h-[40px] text-left">
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('id')}>
                  <div className="flex items-center gap-[2px]">
                    ID
                    {getSortIcon('id')}
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('name')}>
                  <div className="flex items-center gap-[2px]">
                    Name
                    {getSortIcon('name')}
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('type')}>
                  <div className="flex items-center gap-[2px]">
                    Type
                    {getSortIcon('type')}
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('seedAmount')}>
                  <div className="flex items-center gap-[2px]">
                    Seed Percentage
                    {getSortIcon('seedAmount')}
                  </div>
                </th>
                <th className="px-1 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('seedType')}>
                  <div className="flex items-center gap-[2px]">
                    Seed type
                    {getSortIcon('seedType')}
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('period')}>
                  <div className="flex items-center gap-[2px]">
                    Period
                    {getSortIcon('period')}
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] cursor-pointer" onClick={() => requestSort('collectionDays')}>
                  <div className="flex items-center gap-[2px]">
                    Collection days
                    {getSortIcon('collectionDays')}
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">Actions</th>
              </tr>
            </thead>

            <tbody className='border-b border-[#D9D4D4] w-full'>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-4 text-center">
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin h-5 w-5 text-indigo-500 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Loading packages...
                    </div>
                  </td>
                </tr>
              ) : currentPackages.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-4 text-center text-gray-500">
                    {searchTerm ? 'No packages found matching your search' : 'No packages found'}
                  </td>
                </tr>
              ) : (
                currentPackages.map((pkg, index) => (
                  <tr key={pkg.id} className="bg-white transition-all duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">PKG{String(pkg.id).padStart(5, '0')}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{pkg.name}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{pkg.type}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{pkg.type === 'Fixed' ? parseFloat(String(pkg.seedAmount)).toLocaleString() : `${parseFloat(String(pkg.seedAmount)).toLocaleString()}%`}</td>
                    <td className="px-1 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{pkg.seedType}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{pkg.period}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{pkg.collectionDays}</td>
                    <td className="px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal cursor-pointer">
                      <div className="flex gap-2">
                        <Image 
                          src="/icons/edit1.svg" 
                          alt="edit" 
                          onClick={() => handleEditPackage(pkg)} 
                          width={17} 
                          height={17} 
                          className="hover:opacity-70"
                        />
                        <button 
                          onClick={() => handleDeletePackage(pkg.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Mobile stacked rows */}
          <div className="md:hidden block">
            {loading ? (
              <div className="border-b p-4 text-center">
                <div className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 text-indigo-500 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Loading packages...
                </div>
              </div>
            ) : currentPackages.length === 0 ? (
              <div className="border-b p-4 text-center text-gray-500">
                {searchTerm ? 'No packages found matching your search' : 'No packages found'}
              </div>
            ) : (
              currentPackages.map((pkg, index) => (
                <div key={pkg.id} className="border-b p-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm text-gray-600"><span>ID:</span><span className="font-semibold">PKG{String(pkg.id).padStart(5, '0')}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Name:</span><span className="font-semibold">{pkg.name}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Type:</span><span className="font-semibold">{pkg.type}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Seed amount/Percentage:</span><span className="font-semibold">₦{parseFloat(String(pkg.seedAmount)).toLocaleString()}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Seed type:</span><span className="font-semibold">{pkg.seedType}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Period:</span><span className="font-semibold">{pkg.period}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Collection days:</span><span className="font-semibold">{pkg.collectionDays}</span></div>
                    <div className="flex justify-end gap-2 cursor-pointer">
                      <Image 
                        src="/icons/edit1.svg" 
                        alt="edit" 
                        width={17} 
                        height={17} 
                        onClick={() => handleEditPackage(pkg)} 
                        className="hover:opacity-70"
                      />
                      <button 
                        onClick={() => handleDeletePackage(pkg.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      
      <div className='border-t-[1px] w-full mt-[20px]'></div>

      <div className="flex flex-wrap flex-col md:flex-row pb-4 justify-between items-center gap-2 mt-4 px-2 md:px-5">
        {/* Prev Button */}
        <button
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center mb-2 md:mb-0 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Image src="/icons/left.svg" alt="Prev" width={10} height={10} className="mr-1" />
          Previous
        </button>
        {/* Page Numbers */}
        <div className="flex gap-2 items-center justify-center">
          <span className="text-sm text-gray-600">
            Page {currentPage} of {totalPages} ({filteredAndSortedPackages.length} packages)
          </span>
        </div>
        {/* Next Button */}
        <button
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
          <Image src="/icons/right.svg" alt="Next" width={10} height={10} className="ml-1" />
        </button>
      </div>
      </div>

    </div>
  );
}

export default Page