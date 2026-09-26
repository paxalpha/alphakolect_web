"use client"
import React, { useState, useEffect } from 'react'
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
import Addpackage from './Addinvestment';
import Editpackage from './Editinvestment';
import { fetchPackages, deletePackage } from '@/services/api';

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

interface Package {
  id: number;
  name: string;
  type: string;
  amount: number;
  period: number;
  interestRate: number;
  extraCharges: number;
  defaultPenalty: number;
  defaultDays: number;
  duration: number;
  status: string;
  createdAt: string;
  packageCategory?: string;
}

const Page = () => {
  const [show, setShow] = useState<boolean>(false)
  const [filter, setFilter] = useState(false)
  const [packag, setPackag] = useState<boolean>(false)
  const [edit, setEdit] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null)
  
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  // Fetch packages on component mount
  useEffect(() => {
    fetchPackagesData();
  }, []);

  const fetchPackagesData = async () => {
    try {
      setLoading(true);
      const response = await fetchPackages('Investment');
      if (response.success) {
        setPackages(response.packages || []);
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (pkg: Package) => {
    setSelectedPackage(pkg);
    setEdit(true);
  };

  const handleDelete = async (packageId: number) => {
    if (window.confirm('Are you sure you want to delete this package?')) {
      try {
        await deletePackage(packageId);
        fetchPackagesData(); // Refresh the list
      } catch (error) {
        console.error('Error deleting package:', error);
        alert('Failed to delete package');
      }
    }
  };

  const handlePackageCreated = () => {
    fetchPackagesData(); // Refresh the list
  };

  const handlePackageUpdated = () => {
    fetchPackagesData(); // Refresh the list
  };

  // Filter packages based on search and filters
  const filteredPackages = packages.filter(pkg => {
    const matchesSearch = pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         pkg.type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || pkg.status === statusFilter;
    const matchesType = !typeFilter || pkg.type === typeFilter;
    
    return matchesSearch && matchesStatus && matchesType;
  });

  // Pagination
  const totalPages = Math.ceil(filteredPackages.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentPackages = filteredPackages.slice(startIndex, endIndex);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-NG').format(num);
  };

  // ── Export handlers ───────────────────────────────────────
  const invHeaders = ['Package Name', 'Investment Type', 'Target Amount', 'Period', '% Interest', 'Extra Charges', 'Default Penalty', 'Default Days', 'Status'];
  const getInvRows = () => filteredPackages.map(pkg => [
    pkg.name,
    pkg.type,
    formatCurrency(pkg.amount),
    `${pkg.period} days`,
    `${pkg.interestRate}%`,
    formatCurrency(pkg.extraCharges),
    formatCurrency(pkg.defaultPenalty),
    pkg.defaultDays,
    pkg.status
  ]);

  const handleExportPDF = () => {
    setShow(false);
    exportTableToPDF('Investment Packages', invHeaders, getInvRows(), filteredPackages.length);
  };

  const handleExportCSV = () => {
    setShow(false);
    exportToCSV('Investment_Packages', invHeaders, getInvRows());
  };

  return (
    <div className='w-[100%]'>

      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Investment packages</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>Set up and manage investment plans. Define terms, interest rates, charges and penalty.</p>
        </div>

        <div className='flex items-end mt-4 md:mt-0 w-full md:w-auto' onClick={() => setPackag(true)}>
          <button className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'>
            <FaPlus className='text-white font-normal w-[12px]' />
            <p className='text-[14px] font-inter text-white font-medium'>Create package</p>
          </button>
        </div>

      </div>

      {packag && <Addpackage packag={packag} onClose={() => setPackag(false)} onPackageCreated={handlePackageCreated} />}
      {edit && <Editpackage edit={edit} onClose={() => setEdit(false)} packageData={selectedPackage} onPackageUpdated={handlePackageUpdated} />}

      <div className='bg-white shadow-sm mt-[25px] w-full relative'>

        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px] '>

          <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white  transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter &&
                <div className='fixed md:absolute z-50 left-0 right-0 md:left-auto md:right-auto top-0 md:top-auto mx-auto md:mx-0 w-[95%] md:w-[400px] lg:w-[510px] max-w-full md:max-w-[510px] min-w-[230px] md:min-w-[250px] mb-0 md:mb-8 bg-white rounded-b-[8px] md:rounded-[4px] shadow-lg md:p-0' >

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
                    <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Status</p>
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
                      <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Investment type</p>
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

                  <div className='border-t-[1px] w-full mb-1  '></div>

                  <div className='flex gap-[8px] justify-end items-end p-2 md:p-4 mb-2 '>
                    <button onClick={() => setFilter(!filter)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                      <p className='text-[14px] font-inter text-[#4E37FB] font-semibold' >Close</p>
                    </button>
                  </div>

                </div>}
            </div>

            <Select onValueChange={(value) => setRowsPerPage(parseInt(value))}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder={`Show ${rowsPerPage} per row`} />
              </SelectTrigger>
              <SelectContent className="w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="10" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]  ">Show 10 per row</SelectItem>
                  <SelectItem value="15" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">Show 15 per row</SelectItem>
                  <SelectItem value="25" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">Show 25 per row</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

          </div>

          <div className='flex flex-wrap gap-[10px] md:gap-[20px] w-full md:w-auto'>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setShow(!show)} className='bg-[#FAF9FF] h-[40px] cursor-pointer w-[105px] flex items-center justify-center gap-[7px] rounded-[4px]'>
                <p className='text-[#4E37FB] font-medium text-[14px]'>Export</p>
                <FaAngleDown className="w-[16px] h-[16px] text-[#4E37FB] my-[auto] " />
              </button>

              {show && <div className='absolute w-[90vw] max-w-[150px] min-w-[90px] md:w-[105px] bg-white rounded-[4px] shadow-lg z-50'>
                <p onClick={handleExportPDF} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer rounded-[4px] ">PDF</p>
                <p onClick={handleExportCSV} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer rounded-[4px]">CSV</p>
              </div>}
            </div>

            <div className="flex items-center h-[40px] w-full md:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />

              <input
                type="text"
                placeholder="Search packages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>

          </div>
        </div>

         <div className='overflow-auto w-full'>
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4E37FB]"></div>
            </div>
          ) : currentPackages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchTerm || statusFilter || typeFilter ? 'No packages match your filters' : 'No packages found'}
            </div>
          ) : (
            <>
          <table className="table-auto w-full whitespace-nowrap hidden md:table">
            <thead className="bg-gray-50 border-b border-[#D9D4D4]">
              <tr className="h-[40px] text-left">
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Package name</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Investment type</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Target amount</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                  <div className="flex items-center gap-[3px]">
                    Investment period
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                  <div className="flex items-center gap-[3px]">
                    % interest
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Extra charges</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Default penalty (%)</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                  <div className="flex items-center gap-[3px]">
                    Default days
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                    </div>
                  </div>
                </th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Status</th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Actions</th>
              </tr>
            </thead>

            <tbody className="border-b border-[#D9D4D4] w-full">
                  {currentPackages.map((pkg) => (
                    <tr key={pkg.id} className="bg-white transition-all duration-500 hover:bg-gray-50">
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{pkg.name}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{pkg.type}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{formatCurrency(pkg.amount)}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{pkg.period} days</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{pkg.interestRate}%</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{formatCurrency(pkg.extraCharges)}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{pkg.defaultPenalty}%</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{pkg.defaultDays}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          pkg.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {pkg.status}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal flex gap-2">
                        <Image 
                          src="/icons/edit1.svg" 
                          alt="edit" 
                          onClick={() => handleEdit(pkg)} 
                          width={17} 
                          height={17} 
                          className="cursor-pointer hover:opacity-70" 
                        />
                        <Image 
                          src="/icons/delete.svg" 
                          alt="delete" 
                          onClick={() => handleDelete(pkg.id)} 
                          width={17} 
                          height={17} 
                          className="cursor-pointer hover:opacity-70" 
                        />
                      </td>
              </tr>
                  ))}
            </tbody>
          </table>

              {/* Mobile stacked rows */}
              {currentPackages.map((pkg) => (
                <div key={pkg.id} className="md:hidden block border-b p-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Package name:</span>
                      <span className="font-semibold">{pkg.name}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Investment type:</span>
                      <span className="font-semibold">{pkg.type}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Target amount:</span>
                      <span className="font-semibold">{formatCurrency(pkg.amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Investment period:</span>
                      <span className="font-semibold">{pkg.period} days</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>% interest:</span>
                      <span className="font-semibold">{pkg.interestRate}%</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Extra charges:</span>
                      <span className="font-semibold">{formatCurrency(pkg.extraCharges)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Default penalty:</span>
                      <span className="font-semibold">{pkg.defaultPenalty}%</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Default days:</span>
                      <span className="font-semibold">{pkg.defaultDays}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Status:</span>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        pkg.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {pkg.status}
                      </span>
                    </div>
                    <div className="flex justify-end gap-2 cursor-pointer">
                      <Image 
                        src="/icons/edit1.svg" 
                        alt="edit" 
                        width={17} 
                        height={17} 
                        onClick={() => handleEdit(pkg)} 
                        className="hover:opacity-70" 
                      />
                      <Image 
                        src="/icons/delete.svg" 
                        alt="delete" 
                        width={17} 
                        height={17} 
                        onClick={() => handleDelete(pkg.id)} 
                        className="hover:opacity-70" 
                      />
                    </div>
            </div>
          </div>
              ))}
            </>
          )}
        </div>

      <div className='border-t-[1px] w-full mt-[20px]'></div>

      {totalPages > 1 && (
      <div className="flex flex-wrap flex-col md:flex-row pb-4 justify-between items-center gap-2 mt-4 px-2 md:px-5">
        {/* Prev Button */}
        <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center mb-2 md:mb-0 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Image src="/icons/left.svg" alt="Prev" width={10} height={10} className="mr-1" />
          Previous
        </button>
          
        {/* Page Numbers */}
        <div className="flex gap-2 items-center justify-center">
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} ({filteredPackages.length} total packages)
            </span>
        </div>
          
        {/* Next Button */}
        <button
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
          <Image src="/icons/right.svg" alt="Next" width={10} height={10} className="ml-1" />
        </button>
      </div>
      )}
      </div>

    </div>

  )
}

export default Page