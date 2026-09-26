"use client"
import React, { useState, useEffect } from 'react'
import { FaPlus } from 'react-icons/fa'
import { FaAngleDown } from 'react-icons/fa';
import Image from 'next/image';
import { fetchCollections, fetchAgents } from '@/services/api';
import Swal from 'sweetalert2';
import SingleCollectionForm from '@/components/SingleCollectionForm';
import BulkCollectionForm from '@/components/BulkCollectionForm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup
} from "@/components/ui/select"

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

interface Collection {
  id: number;
  customerName: string;
  amount: number;
  dueDate: string;
  type: string;
  status: 'Pending' | 'Collected' | 'Overdue';
  dateCreated: string;
  agentName?: string;
  branch?: string;
  transactionId?: string;
  accountNumber?: string;
}

const Page = () => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState<boolean>(false);
  const [filter, setFilter] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState('10');
  const [currentPage, setCurrentPage] = useState(1);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isSingleFormOpen, setIsSingleFormOpen] = useState(false);
  const [isBulkFormOpen, setIsBulkFormOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const userStr = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
      let hasToken = false;
      try {
        if (userStr) { const parsed = JSON.parse(userStr); hasToken = Boolean(parsed?.token); }
      } catch {}
      if (!hasToken) {
        setCollections([]);
        setAgents([]);
        return;
      }

      const [collectionsRes, agentsRes] = await Promise.all([
        fetchCollections().catch(() => ({ collections: [] })),
        fetchAgents().catch(() => ({ agents: [] }))
      ]);
      
      // Transform collections data to match interface
      const transformedCollections = (collectionsRes.collections || []).map((collection: any, index: number) => {
        const agentName = collection?.customer?.Agent?.fullName || collection?.customer?.agentName || collection?.agentName || '—';
        const amountNumber = typeof collection.amount === 'string' ? parseFloat(collection.amount) : Number(collection.amount || 0);
        const created = collection.dateCreated || collection.createdAt || collection.dueDate;
        const customerAccountNumber = collection?.customer?.accountNumber || '';
        return {
          ...collection,
          amount: amountNumber,
          transactionId: collection.transactionId || `COL-${collection.id}-${String.fromCharCode(65 + (index % 26))}${(index % 100).toString().padStart(2, '0')}`,
          accountNumber: collection.accountNumber || customerAccountNumber || '',
          agentName,
          branch: collection?.customer?.Agent?.branch || '—',
          dateCreated: created,
          customerName: collection.customerName || collection?.customer?.fullName || collection?.customer?.name || ''
        } as Collection;
      });
      try { console.debug('Collections mapped sample:', transformedCollections.slice(0, 3).map((c: Collection) => ({ id: c.id, accountNumber: c.accountNumber, customerName: c.customerName }))); } catch {}
      
      setCollections(transformedCollections);
      setAgents(agentsRes.agents || []);
    } catch (error: any) {
      console.error('Failed to fetch data:', error);
      setCollections([]);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedAgent, selectedStatus, searchTerm, fromDate, toDate, rowsPerPage]);

  // Filter collections based on search, agent, status, and date range
  const filteredCollections = collections.filter(collection => {
    const matchesSearch = collection.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         collection.transactionId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         collection.type.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAgent = selectedAgent === 'all' || collection.agentName === selectedAgent;
    const matchesStatus = selectedStatus === 'all' || collection.status === selectedStatus;
    
    let matchesDateRange = true;
    if (fromDate && toDate) {
      const collectionDate = new Date(collection.dateCreated);
      const from = new Date(fromDate);
      const to = new Date(toDate);
      matchesDateRange = collectionDate >= from && collectionDate <= to;
    }
    
    return matchesSearch && matchesAgent && matchesStatus && matchesDateRange;
  });

  // Pagination
  const totalItems = filteredCollections.length;
  const totalPages = Math.ceil(totalItems / parseInt(rowsPerPage));
  const startIndex = (currentPage - 1) * parseInt(rowsPerPage);
  const paginatedCollections = filteredCollections.slice(startIndex, startIndex + parseInt(rowsPerPage));

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
      }).format(Number(amount) || 0);
    } catch {
      return `₦${Number(amount || 0).toLocaleString()}`;
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  // ── Export handlers ───────────────────────────────────────
  const collHeaders = ['Transaction ID', 'Package', 'Account Number', 'Amount', 'Customer', 'Agent', 'Date', 'Status', 'Branch'];
  const getCollRows = () => filteredCollections.map(c => [
    c.transactionId || '',
    (c as any).packageName || c.type || '',
    c.accountNumber || '',
    formatCurrency(c.amount),
    c.customerName,
    c.agentName || '',
    formatDate(c.dateCreated),
    c.status === 'Collected' ? 'Completed' : c.status,
    c.branch || ''
  ]);

  const handleExportPDF = () => {
    setShow(false);
    exportTableToPDF('Collections', collHeaders, getCollRows(), filteredCollections.length);
  };

  const handleExportCSV = () => {
    setShow(false);
    exportToCSV('Collections', collHeaders, getCollRows());
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Collected':
      case 'Completed':
        return 'text-green-600';
      case 'Pending':
        return 'text-yellow-600';
      case 'Overdue':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
      </div>
    );
  }


  return (
    <>
    <div className='w-full'>
      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Collections</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>View historical daily collections from customers.</p>
        </div>
        <div className='flex flex-wrap gap-3 items-center'>
          <button
            onClick={() => setIsSingleFormOpen(true)}
            className='flex items-center gap-2 bg-white border border-[#D0D5DD] text-[#344054] font-inter font-semibold text-[14px] px-4 py-2 rounded-[8px] hover:bg-gray-50 transition-colors'
          >
            <FaPlus className='w-4 h-4' />
            Create Collection
          </button>
          <button
            onClick={() => setIsBulkFormOpen(true)}
            className='flex items-center gap-2 bg-[#4E37FB] text-white font-inter font-semibold text-[14px] px-4 py-2 rounded-[8px] hover:bg-[#3d2bd4] transition-colors'
          >
            <FaPlus className='w-4 h-4' />
            Bulk Collections
          </button>
        </div>
      </div>

      <div className='bg-white shadow-sm mt-6 w-full relative'>
        <div>
          <div className="flex flex-wrap flex-col md:flex-row p-4 gap-4 md:gap-0 items-stretch md:items-center justify-between">
            <div className='w-full md:w-[330px]'>
              <p className='pb-2'>Agent</p>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                  <SelectValue placeholder="All Agents" />
                </SelectTrigger>
                <SelectContent className="w-full md:w-[330px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                  <SelectGroup>
                    <SelectItem value="all" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">All Agents</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.fullName} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">
                        {agent.fullName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="outline-none leading-[24px] rounded-[4px] w-full md:w-[330px] font-inter text-[14px] bg-white transition-all">
              <p className="text-[14px] font-inter pb-2">From</p>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] font-inter p-1"
              />
            </div>
            <div className="outline-none leading-[24px] rounded-[4px] w-full md:w-[330px] font-inter text-[14px] bg-white transition-all">
              <p className='text-[14px] font-inter pb-2'>To</p>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] font-inter p-1"
              />
            </div>
          </div>

          <div className="flex flex-wrap flex-col md:flex-row p-4 gap-4 md:gap-[20px]">
            <div className="bg-[#FFF8E5] px-5 py-4 rounded-[4px] w-full md:w-[229px] h-[82px] mb-2 md:mb-0">
              <p className='text-[#737373] font-inter font-normal'>Total collection</p>
              <h1 className='font-inter font-semibold text-[20px]'>{filteredCollections.length}</h1>
            </div>
            <div className="bg-[#FFF8E5] px-5 py-4 rounded-[4px] w-full md:w-[229px] h-[82px]">
              <p className='text-[#737373] font-inter font-normal'>Total collection amount</p>
              <h1 className='font-inter font-semibold text-[20px]'>
                {formatCurrency(filteredCollections.reduce((sum, collection) => sum + collection.amount, 0))}
              </h1>
            </div>
          </div>

          <div className='h-[20px] bg-gray-100 w-full mb-1'></div>
        </div>

        <div className='flex flex-wrap flex-col md:flex-row items-center justify-between gap-4 md:gap-10 p-2 md:p-5'>
          <div className='flex flex-wrap flex-col md:flex-row items-center gap-2 md:gap-5 w-full md:w-auto'>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="w-full md:w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="all" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">All Status</SelectItem>
                  <SelectItem value="Pending" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Pending</SelectItem>
                  <SelectItem value="Collected" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Completed</SelectItem>
                  <SelectItem value="Overdue" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Overdue</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={rowsPerPage} onValueChange={setRowsPerPage}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder="Show 10 per row" />
              </SelectTrigger>
              <SelectContent className="w-full md:w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="10" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Show 10 per row</SelectItem>
                  <SelectItem value="15" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Show 15 per row</SelectItem>
                  <SelectItem value="25" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Show 25 per row</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='flex flex-wrap flex-col md:flex-row gap-2 md:gap-5 w-full md:w-auto'>
            <div className='relative w-full md:w-auto mb-2 md:mb-0'>
              <button onClick={() => setShow(!show)} className='bg-[#FAF9FF] h-[40px] cursor-pointer w-full md:w-[105px] flex items-center justify-center gap-[7px] rounded-[4px]'>
                <p className='text-[#4E37FB] font-medium text-[14px]'>Export</p>
                <FaAngleDown className="w-[16px] h-[16px] text-[#4E37FB] my-[auto] " />
              </button>
              {show && <div className='absolute w-[90vw] max-w-[150px] min-w-[90px] md:w-[105px] bg-white rounded-[4px] shadow-lg z-50'>
                <p onClick={handleExportPDF} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">PDF</p>
                <p onClick={handleExportCSV} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">CSV</p>
              </div>}
            </div>
            <div className="flex items-center h-[40px] w-full md:w-[311px] gap-1 border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
              <input
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>
          </div>
        </div>

        <div className='overflow-auto w-full'>
          <table className="table-auto w-full whitespace-nowrap hidden md:table">
            <thead className="bg-gray-50 border-b border-[#D9D4D4]">
              <tr className="h-[40px] text-left">
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                  <div className="flex items-center gap-[3px]">
                    Transaction ID
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Package</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Account number</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Amount</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                  <div className="flex items-center gap-[3px]">
                    Customer
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Agents</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                  <div className="flex items-center gap-[3px]">
                    Date
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Status</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Branch</th>
              </tr>
            </thead>
            <tbody className="border-b border-[#D9D4D4] w-full">
              {paginatedCollections.map((collection) => (
                <tr key={collection.id} className="bg-white transition-all duration-500 hover:bg-gray-50">
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{collection.transactionId}</td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{(collection as any).packageName || collection.type}</td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{collection.accountNumber}</td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{formatCurrency(collection.amount)}</td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{collection.customerName}</td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{collection.agentName}</td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">{formatDate(collection.dateCreated)}</td>
                  <td className={`px-5 py-4 text-[14px] leading-[20px] font-lato font-normal ${getStatusColor(collection.status)}`}>{collection.status === 'Collected' ? 'Completed' : collection.status}</td>
                  <td className="px-5 py-4 text-[14px] leading-[20px] font-lato font-normal text-gray-600">{collection.branch}</td>
                </tr>
              ))}
              {paginatedCollections.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-gray-500">
                    No collections found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          
          {/* Mobile stacked rows */}
          <div className="md:hidden">
            {paginatedCollections.map((collection) => (
              <div key={collection.id} className="block border-b p-2">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm text-gray-600"><span>Transaction ID:</span><span className="font-semibold">{collection.transactionId}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Type:</span><span className="font-semibold">{collection.type}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Account number:</span><span className="font-semibold">{collection.accountNumber}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Amount:</span><span className="font-semibold">{formatCurrency(collection.amount)}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Customer:</span><span className="font-semibold">{collection.customerName}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Agent:</span><span className="font-semibold">{collection.agentName}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Date:</span><span className="font-semibold">{formatDate(collection.dateCreated)}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Status:</span><span className={`font-semibold ${getStatusColor(collection.status)}`}>{collection.status === 'Collected' ? 'Completed' : collection.status}</span></div>
                  <div className="flex justify-between text-sm text-gray-600"><span>Branch:</span><span className="font-semibold">{collection.branch}</span></div>
                </div>
              </div>
            ))}
            {paginatedCollections.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                No collections found
              </div>
            )}
          </div>
        </div>
      
        <div className='border-t w-full mt-5'></div>
        <div className="flex flex-wrap flex-col md:flex-row pb-4 justify-between items-center gap-2 mt-4 px-2 md:px-6">
          {/* Prev Button */}
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center mb-2 md:mb-0 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Image src="/icons/left.svg" alt="Prev" width={10} height={10} className="mr-1" />
            Previous
          </button>
          {/* Page Numbers */}
          <div className="flex gap-2 items-center justify-center">
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} ({totalItems} total)
            </span>
          </div>
          {/* Next Button */}
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Next
            <Image src="/icons/right.svg" alt="Next" width={10} height={10} className="ml-1" />
          </button>
        </div>
      </div>
    </div>

    <SingleCollectionForm
      isOpen={isSingleFormOpen}
      onClose={() => setIsSingleFormOpen(false)}
      onSuccess={() => { setIsSingleFormOpen(false); fetchData(); }}
    />
    <BulkCollectionForm
      isOpen={isBulkFormOpen}
      onClose={() => setIsBulkFormOpen(false)}
      onSuccess={() => { setIsBulkFormOpen(false); fetchData(); }}
    />
    </>
  )
}

export default Page
