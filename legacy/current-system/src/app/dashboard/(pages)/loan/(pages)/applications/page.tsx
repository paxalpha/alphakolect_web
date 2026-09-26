"use client"
import React, { useState, useEffect } from 'react'
import { FaPlus, FaEdit, FaTrash, FaCheck, FaTimes } from 'react-icons/fa'
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
import { fetchLoans, fetchCustomers, fetchAgents, createLoan, updateLoanStatus, deleteLoan, fetchLoanPackages } from '../../../../../../../services/api';
import Swal from 'sweetalert2';
import LoadingButton from '../../../../../../../components/LoadingButton';

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

interface LoanItem {
  id: number;
  customerName: string;
  accountNumber?: string;
  loanAmount: number;
  interestRate: number;
  duration: number;
  agentName?: string;
  branch?: string;
  status: string;
  dateIssued: string;
  dueDate: string;
  totalAmount: number;
  formUrl?: string | null;
}

interface Customer {
  id: number;
  fullName: string;
  accountNumber?: string;
}

interface Agent {
  id: number;
  fullName: string;
}

const Page = () => {
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState<boolean>(false);
  const [filter, setFilter] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [newLoan, setNewLoan] = useState({
    customerName: '',
    accountNumber: '',
    loanAmount: '',
    interestRate: '10',
    duration: '',
    agentId: '',
    branch: '',
    notes: '',
    dueDate: ''
  });
  const [loanFormFile, setLoanFormFile] = useState<File | null>(null);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch data on component mount
  useEffect(() => {
    fetchData();
    fetchCustomers().then((res:any)=>setCustomers(res.customers || res.data || res || []));
    fetchAgents().then((res:any)=>setAgents(res.agents || res.data || res || []));
  }, [selectedStatus, searchTerm, fromDate, toDate, currentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatus, searchTerm, fromDate, toDate, itemsPerPage]);

  useEffect(() => {
    fetchLoanPackages({ limit: 100 }).then((res:any)=> setPackages(res.data || res.packages || res || [])).catch(()=>setPackages([]));
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetchLoans({
        status: selectedStatus !== 'All' ? selectedStatus : undefined,
        search: searchTerm || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        page: currentPage,
        limit: itemsPerPage
      });
      setLoans(response.data || response.loans || response || []);
      setTotalPages(response.pagination?.totalPages || 1);
    } catch (error) {
      console.error('Error fetching loans:', error);
      Swal.fire('Error', 'Failed to fetch loans', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchData();
  };

  const handleStatusUpdate = async (id: number, newStatus: string) => {
    try {
      await updateLoanStatus(id, { status: newStatus });
      Swal.fire('Success', `Loan ${newStatus.toLowerCase()} successfully`, 'success');
      fetchData();
    } catch (error) {
      console.error('Error updating status:', error);
      Swal.fire('Error', 'Failed to update loan status', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
      try {
        await deleteLoan(id);
        Swal.fire('Deleted!', 'Loan has been deleted.', 'success');
        fetchData();
      } catch (error) {
        console.error('Error deleting loan:', error);
        Swal.fire('Error', 'Failed to delete loan', 'error');
      }
    }
  };

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN'
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
        month: 'long',
        day: 'numeric'
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
  const loanAppHeaders = ['Customer', 'Account No.', 'Loan Amount', 'Interest Rate', 'Duration', 'Agent', 'Branch', 'Date Issued', 'Status'];
  const getLoanAppRows = () => loans.map(l => [
    l.customerName, l.accountNumber || 'N/A', formatCurrency(l.loanAmount),
    `${l.interestRate}%`, `${l.duration} days`, l.agentName || 'N/A',
    l.branch || 'N/A', formatDate(l.dateIssued), l.status
  ]);
  const handleExportPDF = () => { setShow(false); exportTableToPDF('Loan Applications', loanAppHeaders, getLoanAppRows(), loans.length); };
  const handleExportCSV = () => { setShow(false); exportToCSV('Loan_Applications', loanAppHeaders, getLoanAppRows()); };

  return (
    <div className='w-[100%]'>
      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Loans</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>Create and manage all loans here. Approve/complete or delete loans.</p>
        </div>
      </div>

      <div className='bg-white shadow-sm mt-[25px] w-full relative'>
        <div className='flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:gap-[10px] p-[10px] md:p-[20px] '>
          <div className='flex flex-wrap items-center gap-[10px] md:gap-[20px] w-full md:w-auto'>
            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white  transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter && (
                <div className='fixed md:absolute z-50 left-0 right-0 md:left-auto md:right-auto top-0 md:top-auto mx-auto md:mx-0 w-[95%] md:w-[400px] lg:w-[510px] max-w-full md:max-w-[510px] min-w-[230px] md:min-w-[250px] mb-0 md:mb-8 bg-white rounded-b-[8px] md:rounded-[4px] shadow-lg md:p-0' >
                  <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px] mb-2 md:p-4">
                    <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                    <button 
                      onClick={() => {
                        setSelectedStatus('all');
                        setFromDate('');
                        setToDate('');
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
                          type="radio" 
                          name='status' 
                          value="All"
                          checked={selectedStatus === 'All'}
                          onChange={(e) => setSelectedStatus(e.target.value)}
                          className='' 
                        />
                        All
                      </div>
                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="radio" 
                          name='status' 
                          value="Pending"
                          checked={selectedStatus === 'Pending'}
                          onChange={(e) => setSelectedStatus(e.target.value)}
                          className='' 
                        />
                        Pending
                      </div>
                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="radio" 
                          name='status' 
                          value="Active"
                          checked={selectedStatus === 'Active'}
                          onChange={(e) => setSelectedStatus(e.target.value)}
                          className='' 
                        />
                        Active
                      </div>
                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="radio" 
                          name='status' 
                          value="Rejected"
                          checked={selectedStatus === 'Rejected'}
                          onChange={(e) => setSelectedStatus(e.target.value)}
                          className='' 
                        />
                        Rejected
                      </div>
                    </div>

                    <div className="mb-6">
                      <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Date Range</p>
                      <div className='flex gap-2'>
                        <input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className='w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]'
                        />
                        <input
                          type="date"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className='w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]'
                        />
                      </div>
                    </div>
                  </div>

                  <div className='border-t-[1px] w-full mb-1'></div>

                  <div className='flex gap-[8px] justify-end items-end p-2 md:p-4 mb-2 '>
                    <button onClick={() => setFilter(!filter)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                      <p className='text-[14px] font-inter text-[#4E37FB] font-semibold' >Close</p>
                    </button>
                    <button onClick={handleSearch} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[99px] rounded-[4px] items-center gap-[9px] justify-center'>
                      <p className='text-[14px] font-inter text-white font-medium'>Apply filters</p>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Select value={String(itemsPerPage)} onValueChange={(value) => setItemsPerPage(Number(value))}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder="Show 10 per row" />
              </SelectTrigger>
              <SelectContent className="w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="10" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]  ">Show 10 per row</SelectItem>
                  <SelectItem value="15" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">Show 15 per row</SelectItem>
                  <SelectItem value="20" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px] ">Show 20 per row</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className='flex flex-wrap gap-[10px] md:gap-[20px] w-full md:w-auto'>
            <button onClick={() => setShowForm(true)} className='bg-[#4E37FB] text-white px-4 py-2 rounded-[4px] h-[40px]'>
              <div className='flex items-center gap-2'>
                <FaPlus className='w-4 h-4' />
                <span>Add loan</span>
              </div>
            </button>
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

            <div className="flex items-center h-[40px] w-full md:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-[4px] px-3">
              <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
              <input
                type="text"
                placeholder="Search by customer name, account number, or agent"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>
          </div>
        </div>

        {/* Add Loan Modal */}
        {showForm && (
          <div className='fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-auto'>
            <div className='bg-white w-full max-w-[600px] rounded-[6px] p-4 max-h-[90vh] overflow-y-auto'>
              <div className='flex justify-between items-center mb-3'>
                <h3 className='text-[16px] font-semibold'>Add Loan</h3>
                <button onClick={() => setShowForm(false)} className='text-gray-500'>✕</button>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                <div>
                  <label className='text-sm'>Customer Name</label>
                  <div className='relative'>
                    <input
                      value={newLoan.customerName}
                      onChange={(e)=>{
                        const val = e.target.value;
                        setNewLoan({...newLoan, customerName: val});
                        if (val.trim().length > 0) {
                          const term = val.toLowerCase();
                          const list = customers.filter((c:any) => (c.fullName || '').toLowerCase().includes(term));
                          setFilteredCustomers(list.slice(0, 8));
                          setShowCustomerDropdown(true);
                        } else {
                          setFilteredCustomers([]);
                          setShowCustomerDropdown(false);
                        }
                      }}
                      onFocus={()=>{
                        if ((newLoan.customerName || '').length > 0 && filteredCustomers.length > 0) setShowCustomerDropdown(true);
                      }}
                      onBlur={()=>{
                        setTimeout(()=>setShowCustomerDropdown(false), 150);
                      }}
                      placeholder='Search or type'
                      className='w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2'
                    />
                    {showCustomerDropdown && (
                      <div className='absolute z-10 mt-1 w-full bg-white border border-[#E5E7EB] rounded-[4px] max-h-56 overflow-auto shadow'>
                        {filteredCustomers.length === 0 && (
                          <div className='px-3 py-2 text-sm text-gray-500'>No matches</div>
                        )}
                        {filteredCustomers.map((c:any) => (
                          <button
                            key={c.id}
                            type='button'
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const matchingAgent = (agents as any[]).find((a:any) =>
                                a.id === c.agentId || (a.fullName && c.agentName && a.fullName.toLowerCase() === c.agentName.toLowerCase())
                              );
                              setNewLoan(prev => ({
                                ...prev,
                                customerName: c.fullName,
                                accountNumber: c.accountNumber || '',
                                agentId: matchingAgent ? matchingAgent.id.toString() : (c.agentId ? String(c.agentId) : prev.agentId),
                                branch: matchingAgent ? matchingAgent.branch : (c.branchName || c.branch || prev.branch)
                              }));
                              setShowCustomerDropdown(false);
                            }}
                            onClick={()=>{
                              const matchingAgent = (agents as any[]).find((a:any) =>
                                a.id === c.agentId || (a.fullName && c.agentName && a.fullName.toLowerCase() === c.agentName.toLowerCase())
                              );
                              setNewLoan(prev => ({
                                ...prev,
                                customerName: c.fullName,
                                accountNumber: c.accountNumber || '',
                                agentId: matchingAgent ? matchingAgent.id.toString() : (c.agentId ? String(c.agentId) : prev.agentId),
                                branch: matchingAgent ? matchingAgent.branch : (c.branchName || c.branch || prev.branch)
                              }));
                              setShowCustomerDropdown(false);
                            }}
                            className='w-full text-left px-3 py-2 hover:bg-gray-50 text-sm cursor-pointer'
                          >
                            <div className='font-medium text-gray-900'>{c.fullName}</div>
                            <div className='text-gray-500 text-xs'>Acct: {c.accountNumber || 'N/A'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className='text-sm'>Account Number</label>
                  <input value={newLoan.accountNumber} onChange={(e)=>setNewLoan({...newLoan, accountNumber:e.target.value})} placeholder='Account number' className='w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2' />
                </div>
                <div>
                  <label className='text-sm font-medium text-gray-700 mb-1 block'>Loan Package</label>
                  <select value={(newLoan as any).packageName || ''} onChange={(e)=>{
                    const pkgName = e.target.value;
                    const pkg = packages.find((p:any)=>p.name===pkgName);
                    
                    let interestVal = '10';
                    let interestLbl = 'Interest Rate (%)';
                    let interestDisp = '';

                    if (pkg) {
                      const type = String(pkg.type || pkg.packageType || '').toLowerCase();
                      const isFlat = type.includes('flat') || 
                                     (pkg.interestAmount !== undefined && pkg.interestAmount !== null && Number(pkg.interestAmount) > 0 && !pkg.loanInterestRate);
                      
                      if (isFlat) {
                        const flatAmt = pkg.interestAmount ?? pkg.interest_amount ?? pkg.interestRate ?? 0;
                        interestVal = String(flatAmt);
                        interestLbl = 'Interest Rate (₦)';
                        interestDisp = `₦${Number(flatAmt).toLocaleString('en-NG')}`;
                      } else {
                        const pctRate = pkg.loanInterestRate ?? pkg.loan_interest_rate ?? pkg.interestRate ?? pkg.interest_rate ?? 0;
                        interestVal = String(pctRate);
                        interestLbl = 'Interest Rate (%)';
                        interestDisp = `${pctRate}%`;
                      }
                    }

                    const chargesAmt = pkg ? parseFloat(pkg.loanCharges || (pkg as any).loan_charges || 0) : 0;

                    setNewLoan({
                      ...newLoan,
                      packageName: pkgName,
                      loanAmount: pkg ? String(pkg.loanAmount || pkg.amount || '') : newLoan.loanAmount,
                      duration: pkg ? String(pkg.loanPeriod || pkg.duration || '') : newLoan.duration,
                      interestRate: pkg ? interestVal : newLoan.interestRate,
                      interestLabel: interestLbl,
                      interestDisplay: interestDisp,
                      loanCharges: chargesAmt
                    } as any);
                  }} className={`w-full h-[40px] border rounded-[4px] px-2 text-sm bg-white ${
                    packages.length === 0 ? 'border-amber-300 text-amber-800 bg-amber-50' : 'border-[#D0D5DD]'
                  }`}>
                    {packages.length === 0 ? (
                      <option value=''>No Loan package created yet</option>
                    ) : (
                      <>
                        <option value=''>Select Loan package</option>
                        {packages.map((p:any)=>(<option key={p.id} value={p.name}>{p.name}</option>))}
                      </>
                    )}
                  </select>
                  {packages.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      ⚠️ No Loan packages found. Please create a Loan package under <strong>Package &gt; Loan</strong> before applying.
                    </p>
                  )}
                </div>
                <div>
                  <label className='text-sm flex justify-between'>
                    <span>Loan Amount</span>
                    {Boolean((newLoan as any).packageName) && <span className='text-xs text-indigo-600 font-normal'>🔒 Locked</span>}
                  </label>
                  <input
                    type='number'
                    value={newLoan.loanAmount}
                    onChange={(e)=>setNewLoan({...newLoan, loanAmount:e.target.value})}
                    placeholder='Amount'
                    readOnly={Boolean((newLoan as any).packageName)}
                    className={`w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 ${
                      Boolean((newLoan as any).packageName) ? 'bg-gray-100 cursor-not-allowed text-gray-700 font-medium' : ''
                    }`}
                  />
                </div>
                <div>
                  <label className='text-sm flex justify-between'>
                    <span>{(newLoan as any).interestLabel || 'Interest Rate (%)'}</span>
                    <span className='text-xs text-indigo-600 font-normal'>🔒 Locked</span>
                  </label>
                  <input
                    type='text'
                    value={
                      (newLoan as any).interestDisplay
                        ? (newLoan as any).interestDisplay
                        : ((newLoan as any).packageName ? `${newLoan.interestRate}%` : newLoan.interestRate ? `${newLoan.interestRate}%` : '')
                    }
                    disabled={true}
                    readOnly={true}
                    placeholder='Autofilled by loan package'
                    className='w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 bg-gray-100 cursor-not-allowed text-gray-700 font-medium'
                  />
                </div>
                {(newLoan as any).loanCharges > 0 && (
                <div>
                  <label className='text-sm flex justify-between'>
                    <span>Loan Package Charges</span>
                    <span className='text-xs text-red-600 font-normal'>Deducted from collection wallet</span>
                  </label>
                  <input
                    type='text'
                    value={`₦${Number((newLoan as any).loanCharges || 0).toLocaleString('en-NG')}`}
                    disabled={true}
                    readOnly={true}
                    className='w-full h-[40px] border border-red-200 rounded-[4px] px-2 bg-red-50 cursor-not-allowed text-red-700 font-medium'
                  />
                </div>
                )}
                <div>
                  <label className='text-sm flex justify-between'>
                    <span>Duration (days)</span>
                    {Boolean((newLoan as any).packageName) && <span className='text-xs text-indigo-600 font-normal'>🔒 Locked</span>}
                  </label>
                  <input
                    type='number'
                    value={newLoan.duration}
                    onChange={(e)=>setNewLoan({...newLoan, duration:e.target.value})}
                    placeholder='e.g. 180'
                    readOnly={Boolean((newLoan as any).packageName)}
                    className={`w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 ${
                      Boolean((newLoan as any).packageName) ? 'bg-gray-100 cursor-not-allowed text-gray-700 font-medium' : ''
                    }`}
                  />
                </div>
                <div>
                  <label className='text-sm'>Due Date</label>
                  <input type='date' value={newLoan.dueDate} onChange={(e)=>setNewLoan({...newLoan, dueDate:e.target.value})} className='w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2' />
                </div>
                <div>
                  <label className='text-sm flex justify-between'>
                    <span>Agent</span>
                    {Boolean(newLoan.customerName && (customers as any[]).some((c:any) => c.fullName?.toLowerCase() === newLoan.customerName.trim().toLowerCase())) && (
                      <span className='text-xs text-indigo-600 font-normal'>🔒 Locked</span>
                    )}
                  </label>
                  <select
                    value={newLoan.agentId}
                    disabled={Boolean(newLoan.customerName && (customers as any[]).some((c:any) => c.fullName?.toLowerCase() === newLoan.customerName.trim().toLowerCase()))}
                    onChange={(e)=>{
                      const val = e.target.value;
                      const selected = (agents as any[]).find((a:any) => a.id.toString() === val);
                      setNewLoan({
                        ...newLoan,
                        agentId: val,
                        branch: selected?.branch || newLoan.branch
                      });
                    }}
                    className={`w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 ${
                      Boolean(newLoan.customerName && (customers as any[]).some((c:any) => c.fullName?.toLowerCase() === newLoan.customerName.trim().toLowerCase())) ? 'bg-gray-100 cursor-not-allowed text-gray-700 font-medium' : ''
                    }`}
                  >
                    <option value=''>Select agent</option>
                    {agents.map((a:any) => (
                      <option key={a.id} value={a.id.toString()}>{a.fullName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className='text-sm flex justify-between'>
                    <span>Branch</span>
                    {Boolean(newLoan.customerName && (customers as any[]).some((c:any) => c.fullName?.toLowerCase() === newLoan.customerName.trim().toLowerCase())) && (
                      <span className='text-xs text-indigo-600 font-normal'>🔒 Locked</span>
                    )}
                  </label>
                  <input
                    value={newLoan.branch}
                    onChange={(e)=>setNewLoan({...newLoan, branch:e.target.value})}
                    placeholder='Branch'
                    readOnly={Boolean(newLoan.customerName && (customers as any[]).some((c:any) => c.fullName?.toLowerCase() === newLoan.customerName.trim().toLowerCase()))}
                    className={`w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 ${
                      Boolean(newLoan.customerName && (customers as any[]).some((c:any) => c.fullName?.toLowerCase() === newLoan.customerName.trim().toLowerCase())) ? 'bg-gray-100 cursor-not-allowed text-gray-700 font-medium' : ''
                    }`}
                  />
                </div>
                <div className='md:col-span-2'>
                  <label className='text-sm'>Notes</label>
                  <textarea value={newLoan.notes} onChange={(e)=>setNewLoan({...newLoan, notes:e.target.value})} placeholder='Notes' className='w-full min-h-[70px] border border-[#D0D5DD] rounded-[4px] px-2 py-2' />
                </div>
                <div className='md:col-span-2'>
                  <label className='text-sm'>Upload loan form (PDF/Image)</label>
                  <input type='file' accept='.pdf,image/*' onChange={(e)=>setLoanFormFile(e.target.files?.[0] || null)} className='w-full' />
                </div>
              </div>
              <div className='flex justify-end gap-2 mt-4'>
                <button onClick={()=>setShowForm(false)} className='px-4 py-2 border rounded-[4px]'>Cancel</button>
                <LoadingButton
                  loading={submitting}
                  loadingText="Saving..."
                  onClick={async ()=>{
                    try {
                      if (!newLoan.customerName || !newLoan.loanAmount || !newLoan.duration || !newLoan.dueDate) {
                        return Swal.fire('Missing fields', 'Please fill required fields', 'warning');
                      }
                      setSubmitting(true);
                      await createLoan({
                        customerName: newLoan.customerName,
                        accountNumber: newLoan.accountNumber || undefined,
                        packageName: (newLoan as any).packageName || undefined,
                        loanAmount: Number(newLoan.loanAmount),
                        interestRate: Number(newLoan.interestRate || 0),
                        duration: Number(newLoan.duration),
                        agentId: newLoan.agentId ? Number(newLoan.agentId) : undefined,
                        branch: newLoan.branch || undefined,
                        notes: newLoan.notes || undefined,
                        dueDate: newLoan.dueDate,
                        loanFormFile: loanFormFile || undefined,
                      });
                      setShowForm(false);
                      setNewLoan({ customerName: '', accountNumber: '', loanAmount: '', interestRate: '10', duration: '', agentId: '', branch: '', notes: '', dueDate: '' });
                      setLoanFormFile(null);
                      await fetchData();
                      Swal.fire('Success', 'Loan created successfully', 'success');
                    } catch (error:any) {
                      Swal.fire('Error', error.message || 'Failed to create loan', 'error');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className='px-4 py-2 bg-[#4E37FB] text-white rounded-[4px]'
                >
                  Save loan
                </LoadingButton>
              </div>
            </div>
          </div>
        )}

        <div className='overflow-auto w-full'>
          <table className="table-auto w-full whitespace-nowrap hidden md:table">
            <thead className="bg-gray-50 border-b border-[#D9D4D4]">
              <tr className="h-[40px] text-left">
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Customer</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Account number</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Loan amount</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Interest Rate</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Duration</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Agent</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Branch</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Date Issued</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Status</th>
                <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Actions</th>
              </tr>
            </thead>

            <tbody className="border-b border-[#D9D4D4] w-full">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-5 py-4 text-center">Loading...</td>
                </tr>
              ) : loans.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-4 text-center">No loan applications found</td>
                </tr>
              ) : (
                loans.map((loan) => (
                  <tr key={loan.id} className="bg-white transition-all duration-500 hover:bg-gray-50">
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{loan.customerName}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{loan.accountNumber || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{formatCurrency(loan.loanAmount)}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                      {(() => {
                        const pkg = packages.find((p: any) => p.name === (loan as any).packageName || p.name === (loan as any).package);
                        const isFlat = pkg 
                          ? (String(pkg.type || pkg.packageType || '').toLowerCase().includes('flat') || (pkg.interestAmount !== undefined && pkg.interestAmount !== null && Number(pkg.interestAmount) > 0 && !pkg.loanInterestRate))
                          : Number(loan.interestRate || 0) > 100;
                        if (isFlat) {
                          const flatVal = pkg?.interestAmount ?? pkg?.interest_amount ?? loan.interestRate ?? 0;
                          return `₦${Number(flatVal).toLocaleString('en-NG')}`;
                        }
                        return `${loan.interestRate || 0}%`;
                      })()}
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{loan.duration} days</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{loan.agentName || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{loan.branch || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{formatDate(loan.dateIssued)}</td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(loan.status)}`}>
                        {loan.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                      <div className="flex gap-2 items-center">
                        {loan.formUrl && (
                          <button
                            onClick={() => window.open(loan.formUrl as string, '_blank')}
                            className="px-2 py-1 border rounded text-[12px] hover:bg-gray-50"
                            title="View uploaded form"
                          >
                            View Form
                          </button>
                        )}
                        {loan.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => handleStatusUpdate(loan.id, 'Active')}
                              className="p-1 text-green-600 hover:bg-green-100 rounded"
                              title="Approve"
                            >
                              <FaCheck size={16} />
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(loan.id, 'Defaulted')}
                              className="p-1 text-red-600 hover:bg-red-100 rounded"
                              title="Reject"
                            >
                              <FaTimes size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Mobile stacked rows */}
          {!loading && loans.length > 0 && (
            <div className="md:hidden block">
              {loans.map((loan) => (
                <div key={loan.id} className="border-b p-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Customer:</span>
                      <span className="font-semibold">{loan.customerName}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Account Number:</span>
                      <span className="font-semibold">{loan.accountNumber || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Loan Amount:</span>
                      <span className="font-semibold">{formatCurrency(loan.loanAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Interest Rate:</span>
                      <span className="font-semibold">
                        {(() => {
                          const pkg = packages.find((p: any) => p.name === (loan as any).packageName || p.name === (loan as any).package);
                          const isFlat = pkg 
                            ? (String(pkg.type || pkg.packageType || '').toLowerCase().includes('flat') || (pkg.interestAmount !== undefined && pkg.interestAmount !== null && Number(pkg.interestAmount) > 0 && !pkg.loanInterestRate))
                            : Number(loan.interestRate || 0) > 100;
                          if (isFlat) {
                            const flatVal = pkg?.interestAmount ?? pkg?.interest_amount ?? loan.interestRate ?? 0;
                            return `₦${Number(flatVal).toLocaleString('en-NG')}`;
                          }
                          return `${loan.interestRate || 0}%`;
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Duration:</span>
                      <span className="font-semibold">{loan.duration} days</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Agent:</span>
                      <span className="font-semibold">{loan.agentName || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Branch:</span>
                      <span className="font-semibold">{loan.branch || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Date Issued:</span>
                      <span className="font-semibold">{formatDate(loan.dateIssued)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Status:</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(loan.status)}`}>
                        {loan.status}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-2 items-center">
                      {loan.formUrl && (
                        <button
                          onClick={() => window.open(loan.formUrl as string, '_blank')}
                          className="px-3 py-1 border rounded text-sm"
                        >
                          View Form
                        </button>
                      )}
                      {loan.status === 'Pending' && (
                        <>
                          <button
                            onClick={() => handleStatusUpdate(loan.id, 'Active')}
                            className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleStatusUpdate(loan.id, 'Defaulted')}
                            className="px-3 py-1 bg-red-600 text-white rounded text-sm"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='border-t-[1px] w-full mt-[20px]'></div>

        <div className="flex flex-wrap flex-col md:flex-row pb-4 justify-between items-center gap-2 mt-4 px-2 md:px-6">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center mb-2 md:mb-0 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Image src="/icons/left.svg" alt="Prev" width={10} height={10} className="mr-1" />
            Previous
          </button>
          
          <div className="flex gap-2 items-center justify-center">
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
          </div>
          
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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