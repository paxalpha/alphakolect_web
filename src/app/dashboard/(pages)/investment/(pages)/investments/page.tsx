"use client"
import React, { useState, useEffect } from 'react'
import { FaAngleDown } from 'react-icons/fa';
import Image from 'next/image';
import { 
  fetchInvestmentApplications, 
  fetchCustomers, 
  fetchAgents,
  updateInvestmentApplicationStatus,
  deleteInvestmentApplication 
} from '@/services/api';
import Swal from 'sweetalert2';
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
  const html = `<div class="print-table-area"><div class="print-header"><div class="print-header-title">${title}</div><div class="print-header-meta">Generated: ${now}<br/>Total records: ${rowCount}</div></div><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table><div class="print-footer">AlphaKolect &mdash; Confidential &mdash; ${now}</div></div>`;
  let portal = document.getElementById('print-portal');
  if (!portal) { portal = document.createElement('div'); portal.id = 'print-portal'; document.body.appendChild(portal); }
  portal.innerHTML = html;
  window.print();
  setTimeout(() => { if (portal) portal.innerHTML = ''; }, 1000);
}
function exportToCSV(title: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

interface InvestmentApplication {
  id: number;
  customerName: string;
  accountNumber: string;
  targetAmount: number;
  duration: number;
  agentName: string;
  branch: string;
  dateApplied: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Completed';
  notes?: string;
  rejectionReason?: string;
  customer?: {
    id: number;
    fullName: string;
    email: string;
    phoneNumber: string;
  };
  agent?: {
    id: number;
    fullName: string;
    phoneNumber: string;
  };
}

interface Customer {
  id: number;
  fullName: string;
  accountNumber: string;
}

interface Agent {
  id: number;
  fullName: string;
  email: string;
  phoneNumber: string;
  branch: string;
}

const Page = () => {
  const [show, setShow] = useState<boolean>(false)
  const [applications, setApplications] = useState<InvestmentApplication[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('Approved');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatus, selectedAgent, fromDate, toDate, itemsPerPage]);

  // Fetch data whenever relevant state changes
  useEffect(() => {
    fetchData();
  }, [currentPage, selectedStatus, selectedAgent, fromDate, toDate, itemsPerPage]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [applicationsRes, agentsRes] = await Promise.all([
        fetchInvestmentApplications({
          status: selectedStatus === 'all' ? undefined : selectedStatus,
          search: searchTerm || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          page: currentPage,
          limit: itemsPerPage
        }),
        fetchAgents()
      ]);
      
      setApplications(applicationsRes.applications || []);
      setTotalPages(applicationsRes.pagination?.totalPages || 1);
      setAgents(agentsRes.agents || []);
    } catch (error: any) {
      console.error('Failed to fetch data:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to load investments data',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchData();
  };

  // Client-side filter by agent (if not supported server-side)
  const displayedApplications = selectedAgent === 'all'
    ? applications
    : applications.filter(a => {
        const name = a.agent?.fullName || a.agentName || '';
        return name === selectedAgent;
      });

  // Calculate totals
  const approvedApplications = displayedApplications.filter(app => app.status === 'Approved');
  const activeInvestments = approvedApplications.length;
  const totalAmount = approvedApplications.reduce((sum, app) => sum + Number(app.targetAmount || 0), 0);

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
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'Approved': return 'bg-green-100 text-green-800';
      case 'Rejected': return 'bg-red-100 text-red-800';
      case 'Completed': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // ── Export handlers ───────────────────────────────────────
  const invHeaders = ['Customer', 'Account No.', 'Target Amount', 'Duration', 'Agent', 'Date Applied', 'Status'];
  const getInvRows = () => approvedApplications.map(a => [
    a.customer?.fullName || a.customerName,
    a.accountNumber || 'N/A',
    formatCurrency(a.targetAmount),
    `${a.duration} days`,
    a.agent?.fullName || a.agentName || 'N/A',
    formatDate(a.dateApplied),
    a.status
  ]);
  const handleExportPDF = () => { setShow(false); exportTableToPDF('Investments', invHeaders, getInvRows(), approvedApplications.length); };
  const handleExportCSV = () => { setShow(false); exportToCSV('Investments', invHeaders, getInvRows()); };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
      </div>
    );
  }


  return (
    <div className='w-full'>
      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[20px] md:text-[24px]'>Investments</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[13px] md:text-[14px] '>View and manage customer investment applications. Track performance and monitor returns.</p>
        </div>
      </div>

      <div className='bg-white shadow-sm mt-6 w-full relative'>
        <div>
          <div className="flex flex-wrap flex-col md:flex-row p-4 gap-4 md:gap-0 items-stretch md:items-center justify-between">
            <div className='w-full md:w-[330px]'>
              <p className='pb-2 text-[14px] font-inter'>Status</p>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent className="w-full md:w-[330px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                  <SelectGroup>
                    <SelectItem value="all" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">All Status</SelectItem>
                    <SelectItem value="Pending" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Pending</SelectItem>
                    <SelectItem value="Approved" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Approved</SelectItem>
                    <SelectItem value="Rejected" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Rejected</SelectItem>
                    <SelectItem value="Completed" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Completed</SelectItem>
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
                className="w-full h-[40px]  border border-[#D0D5DD] rounded-[4px] font-inter p-1"
              />
            </div>
            <div className="outline-none leading-[24px] rounded-[4px] w-full md:w-[330px] font-inter text-[14px] bg-white transition-all">
              <p className='text-[14px] font-inter pb-2'>To</p>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full h-[40px]  border border-[#D0D5DD] rounded-[4px] font-inter p-1"
              />
            </div>
          </div>

          <div className="flex flex-wrap flex-col md:flex-row p-4 gap-4 md:gap-[20px]">
            <div className="bg-[#FFF8E5] px-5 py-4 rounded-[4px] w-full md:w-[229px] h-[82px] mb-2 md:mb-0">
              <p className='text-[#737373] font-inter font-normal text-[13px] md:text-[14px]'>Total active investments</p>
              <h1 className='font-inter font-semibold text-[18px] md:text-[20px]'>{activeInvestments}</h1>
            </div>
            <div className="bg-[#FFF8E5] px-5 py-4 rounded-[4px] w-full md:w-[229px] h-[82px]">
              <p className='text-[#737373] font-inter font-normal text-[13px] md:text-[14px]'>Total investment amount</p>
              <h1 className='font-inter font-semibold text-[18px] md:text-[20px]'>{formatCurrency(totalAmount)}</h1>
            </div>
          </div>

          <div className='h-[20px] bg-gray-100 w-full mb-1'></div>
        </div>

        <div className='flex flex-wrap flex-col md:flex-row items-center justify-between gap-4 md:gap-10 p-2 md:p-5'>
          <div className='flex flex-wrap flex-col md:flex-row items-center gap-2 md:gap-5 w-full md:w-auto'>

            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder="All Agents" />
              </SelectTrigger>
              <SelectContent className="w-full md:w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="all" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">All Agents</SelectItem>
                  {agents.map(agent => (
                    <SelectItem key={agent.id} value={agent.fullName} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">
                      {agent.fullName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(Number(value))}>
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
              {show && <div className='absolute w-full md:w-[105px] bg-white rounded-[4px] shadow-lg z-10'>
                <p onClick={handleExportPDF} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">PDF</p>
                <p onClick={handleExportCSV} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">CSV</p>
              </div>}
            </div>
            <div className="flex items-center h-[40px] w-full md:w-[311px] gap-1 border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
              <input
                type="text"
                placeholder="Search applications..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>
          </div>
        </div>
        <div className='overflow-auto w-full'>
          <table className="table-auto w-full whitespace-nowrap hidden md:table">
            <thead className="bg-gray-50 border-b border-[#D9D4D4]">
              <tr>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">
                  <div className="flex items-center gap-[3px]">
                    Customer
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} />
                      <Image src="/icons/downarr.svg" alt="downarrow" width={8} height={8} />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">Account Number</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">Target Amount</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">
                  <div className="flex items-center gap-[3px]">
                    Duration
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} />
                      <Image src="/icons/downarr.svg" alt="downarrow" width={8} height={8} />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">Agent</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">
                  <div className="flex items-center gap-[3px]">
                    Date Applied
                    <div className="flex flex-col gap-[1px] shrink-0">
                      <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} />
                      <Image src="/icons/downarr.svg" alt="downarrow" width={8} height={8} />
                    </div>
                  </div>
                </th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414]">Status</th>
              </tr>
            </thead>
            <tbody>
              {approvedApplications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-500">No investments found</td>
                </tr>
              ) : approvedApplications.map((application) => (
                <tr key={application.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    {application.customer?.fullName || application.customerName}
                  </td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    {application.accountNumber || 'N/A'}
                  </td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    {formatCurrency(application.targetAmount)}
                  </td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    {application.duration} days
                  </td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    {application.agent?.fullName || application.agentName || 'N/A'}
                  </td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    {formatDate(application.dateApplied)}
                  </td>
                  <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal">
                    <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(application.status)}`}>
                      {application.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile stacked rows */}
          {approvedApplications.map((application) => (
            <div key={application.id} className="md:hidden block border-b p-4">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Customer:</span>
                  <span className="font-semibold">{application.customer?.fullName || application.customerName}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Account Number:</span>
                  <span className="font-semibold">{application.accountNumber || 'N/A'}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Target Amount:</span>
                  <span className="font-semibold">{formatCurrency(application.targetAmount)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Duration:</span>
                  <span className="font-semibold">{application.duration} days</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Agent:</span>
                  <span className="font-semibold">{application.agent?.fullName || application.agentName || 'N/A'}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Date Applied:</span>
                  <span className="font-semibold">{formatDate(application.dateApplied)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Status:</span>
                  <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(application.status)}`}>
                    {application.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
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
            <p>Page {currentPage} of {totalPages}</p>
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
  )
}

export default Page