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
import { fetchRepayments, fetchCustomers, fetchAgents, updateRepaymentStatus, deleteRepayment, fetchRepaymentStats, createRepayment, fetchLoans, fetchLoanPackages, fetchLoanById } from '../../../../../../../services/api';
import Swal from 'sweetalert2';

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

interface Repayment {
  id: number;
  transactionId: string;
  customerName: string;
  accountNumber?: string;
  package?: string;
  amount: number;
  branch?: string;
  agentName?: string;
  date: string;
  status: string;
  paymentMethod?: string;
  reference?: string;
}

interface Customer {
  id: number;
  fullName: string;
  phone?: string;
}

interface Agent {
  id: number;
  fullName: string;
}

interface LoanItem {
  id: number;
  customerId?: number;
  customerName: string;
  accountNumber?: string;
  packageName?: string;
  package?: string;
  loanPackage?: string;
  loanAmount?: number;
  totalAmount?: number;
  remainingAmount?: number;
  amountPaid?: number;
  status?: string;
  agentId?: number;
  branch?: string;
}

const CreateRepaymentModal = ({
  onClose,
  onSuccess,
  customers,
  agents,
  loans,
  loanPackages
}: {
  onClose: () => void;
  onSuccess: () => void;
  customers: Customer[];
  agents: Agent[];
  loans: LoanItem[];
  loanPackages: any[];
}) => {
  const [submitting, setSubmitting] = useState(false);

  // Filter for active/approved loans
  const approvedLoans = React.useMemo(() => {
    const active = loans.filter((l: any) => {
      const st = (l.status || '').toLowerCase();
      return st === 'active' || st === 'approved';
    });
    return active.length > 0 ? active : loans;
  }, [loans]);

  // Approved customers (only customers with approved loans)
  const approvedCustomers = React.useMemo(() => {
    const map = new Map<string, { id?: number; name: string; accountNumber: string }>();
    approvedLoans.forEach((l: any) => {
      const name = l.customerName || '';
      if (!name) return;
      const key = String(l.customerId || name).toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: l.customerId,
          name: name,
          accountNumber: l.accountNumber || '',
        });
      }
    });
    return Array.from(map.values());
  }, [approvedLoans]);

  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id?: number; name: string; accountNumber: string } | null>(null);

  // Customer's approved loans (for package dropdown)
  const customerApprovedLoans = React.useMemo(() => {
    if (!selectedCustomer) return [];
    return approvedLoans.filter((l: any) => {
      if (selectedCustomer.id && l.customerId) {
        return String(l.customerId) === String(selectedCustomer.id);
      }
      return (l.customerName || '').toLowerCase() === selectedCustomer.name.toLowerCase();
    });
  }, [selectedCustomer, approvedLoans]);

  const [form, setForm] = useState({
    loanId: '',
    customerName: '',
    accountNumber: '',
    packageName: '',
    packageAmount: '',
    outstandingAmount: '',
    amountToPay: '',
    agentId: '',
    branch: '',
    paymentMethod: 'Cash',
    reference: '',
    notes: ''
  });

  const handleSelectCustomer = (cust: { id?: number; name: string; accountNumber: string }) => {
    setSelectedCustomer(cust);
    setCustomerSearchTerm(cust.name);
    setShowCustomerDropdown(false);
    setForm(prev => ({
      ...prev,
      customerName: cust.name,
      loanId: '',
      accountNumber: cust.accountNumber || '',
      packageName: '',
      packageAmount: '',
      outstandingAmount: '',
      amountToPay: '',
      agentId: '',
      branch: ''
    }));
  };

  const handleSelectPackage = (loanIdStr: string) => {
    const loan = customerApprovedLoans.find((l: any) => String(l.id) === loanIdStr);
    if (loan) {
      const pkgName = loan.packageName || loan.package || (loan as any).loanPackage || (loan as any).Package?.name || (`Loan #${loan.id}`);
      const loanAmt = Number(loan.loanAmount || 0);
      let interest = 0;
      if (loan.totalAmount && Number(loan.totalAmount) > loanAmt) {
        interest = Number(loan.totalAmount) - loanAmt;
      } else {
        const rate = Number((loan as any).interestRate || 0);
        if (rate > 100) {
          interest = rate; // Flat rate
        } else {
          interest = loanAmt * (rate / 100);
        }
      }
      const totalWithInterest = loanAmt + interest;
      const paid = Number((loan as any).amountPaid || 0);
      
      let outstanding = 0;
      if (loan.remainingAmount !== undefined && loan.remainingAmount !== null && Number(loan.remainingAmount) >= 0 && Number(loan.remainingAmount) < totalWithInterest) {
        outstanding = Number(loan.remainingAmount);
      } else {
        outstanding = Math.max(0, totalWithInterest - paid);
      }

      setForm(prev => ({
        ...prev,
        loanId: String(loan.id),
        packageName: pkgName,
        packageAmount: String(totalWithInterest),
        outstandingAmount: String(outstanding),
        accountNumber: loan.accountNumber || selectedCustomer?.accountNumber || prev.accountNumber,
        agentId: loan.agentId ? String(loan.agentId) : prev.agentId,
        branch: loan.branch || prev.branch,
        amountToPay: outstanding > 0 ? String(outstanding) : String(totalWithInterest)
      }));
    } else {
      setForm(prev => ({
        ...prev,
        loanId: '',
        packageName: '',
        packageAmount: '',
        outstandingAmount: '',
        amountToPay: ''
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.loanId) {
      return Swal.fire('Warning', 'Please select an approved loan package', 'warning');
    }
    if (!form.amountToPay || parseFloat(form.amountToPay) <= 0) {
      return Swal.fire('Warning', 'Please enter a valid repayment amount', 'warning');
    }
    setSubmitting(true);
    try {
      await createRepayment({
        loanId: parseInt(form.loanId),
        customerName: form.customerName,
        accountNumber: form.accountNumber || undefined,
        package: form.packageName || undefined,
        amount: parseFloat(form.amountToPay),
        agentId: form.agentId ? parseInt(form.agentId) : undefined,
        branch: form.branch || undefined,
        reference: form.reference || undefined
      });

      Swal.fire('Success', 'Repayment created successfully', 'success');
      onSuccess();
    } catch (error: any) {
      Swal.fire('Error', error.message || 'Failed to create repayment', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredCustomerList = approvedCustomers.filter(c => 
    c.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    (c.accountNumber && c.accountNumber.toLowerCase().includes(customerSearchTerm.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-white rounded-[6px] w-full max-w-[520px] shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-[18px] font-semibold">Add repayment</h2>
          <button onClick={onClose} className="text-sm underline">Close</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Searchable Customer Input */}
          <div className="relative">
            <label className="block text-sm mb-1 font-medium">Customer (Approved Loans Only)</label>
            <input
              type="text"
              value={customerSearchTerm}
              onChange={(e) => {
                setCustomerSearchTerm(e.target.value);
                setShowCustomerDropdown(true);
                if (selectedCustomer && e.target.value !== selectedCustomer.name) {
                  setSelectedCustomer(null);
                  setForm(prev => ({ ...prev, loanId: '', customerName: '', packageName: '', packageAmount: '', outstandingAmount: '', accountNumber: '' }));
                }
              }}
              onFocus={() => setShowCustomerDropdown(true)}
              placeholder="Search approved loan customer by name or acct no..."
              className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-3 outline-none focus:border-[#4E37FB]"
              required
            />
            {showCustomerDropdown && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-[#E5E7EB] rounded-[4px] max-h-52 overflow-auto shadow-lg">
                {filteredCustomerList.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    {approvedCustomers.length === 0 ? 'No approved loan customers found' : 'No matching customer'}
                  </div>
                ) : (
                  filteredCustomerList.map((c, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectCustomer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-[#F3F8FF] text-sm border-b last:border-b-0"
                    >
                      <div className="font-medium text-gray-900">{c.name}</div>
                      {c.accountNumber && <div className="text-xs text-gray-500">Acct: {c.accountNumber}</div>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Customer's Approved Loan Packages */}
          <div>
            <label className="block text-sm mb-1 font-medium">Approved Loan Package</label>
            <select
              value={form.loanId}
              onChange={(e) => handleSelectPackage(e.target.value)}
              className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 outline-none focus:border-[#4E37FB]"
              required
              disabled={!selectedCustomer}
            >
              <option value="">
                {!selectedCustomer ? 'Select a customer first' : customerApprovedLoans.length === 0 ? 'No active loan package found' : 'Select approved loan package'}
              </option>
              {customerApprovedLoans.map((l: any) => {
                const name = l.packageName || l.package || (l as any).loanPackage || (l as any).Package?.name || (`Loan #${l.id}`);
                const lAmt = Number(l.loanAmount || 0);
                let displayInterest = 0;
                if (l.totalAmount && Number(l.totalAmount) > lAmt) {
                  displayInterest = Number(l.totalAmount) - lAmt;
                } else {
                  const iRate = Number((l as any).interestRate || 0);
                  displayInterest = iRate > 100 ? iRate : lAmt * (iRate / 100);
                }
                const totalWithInterest = lAmt + displayInterest;
                return (
                  <option key={l.id} value={l.id}>
                    {name} — ₦{totalWithInterest.toLocaleString()}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Package Amount & Outstanding */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1 font-medium">Package amount</label>
              <input
                type="text"
                value={form.packageAmount ? `₦${Number(form.packageAmount).toLocaleString()}` : ''}
                readOnly
                className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 bg-gray-50 cursor-not-allowed"
                placeholder="Auto-filled"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 font-medium">Outstanding amount</label>
              <input
                type="text"
                value={form.outstandingAmount ? `₦${Number(form.outstandingAmount).toLocaleString()}` : ''}
                readOnly
                className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 bg-gray-50 cursor-not-allowed text-[#D92D20] font-semibold"
                placeholder="Auto-filled"
              />
            </div>
          </div>

          {/* Amount to Pay */}
          <div>
            <label className="block text-sm mb-1 font-medium">Amount to pay (₦)</label>
            <input
              type="number"
              value={form.amountToPay}
              onChange={(e) => setForm({ ...form, amountToPay: e.target.value })}
              className="w-full h-[40px] border border-[#4E37FB] rounded-[4px] px-2 focus:ring-1 focus:ring-[#4E37FB] outline-none"
              placeholder="Enter repayment amount"
              required
            />
          </div>

          {/* Account Number & Reference */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1 font-medium font-inter">Account number</label>
              <input
                value={form.accountNumber}
                readOnly
                className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2 bg-gray-50 cursor-not-allowed"
                placeholder="Auto-filled"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 font-medium font-inter">Reference</label>
              <input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                className="w-full h-[40px] border border-[#D0D5DD] rounded-[4px] px-2"
                placeholder="Optional reference"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-[40px] px-4 rounded-[4px] border">Cancel</button>
            <button type="submit" disabled={submitting} className="h-[40px] px-4 rounded-[4px] bg-[#4E37FB] text-white disabled:opacity-50 font-medium">
              {submitting ? 'Saving...' : 'Post repayment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Page = () => {
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(false);
  const [show, setShow] = useState<boolean>(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedAgent, setSelectedAgent] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [stats, setStats] = useState({
    totalCollection: 0,
    totalCollectionAmount: 0
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [loanPackages, setLoanPackages] = useState<any[]>([]);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  useEffect(() => {
    fetchData();
    fetchStats();
  }, [currentPage, itemsPerPage, selectedStatus, selectedAgent, fromDate, toDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatus, selectedAgent, searchTerm, fromDate, toDate, itemsPerPage]);

  useEffect(() => {
    fetchLoanPackages({ limit: 100 }).then((res:any)=> setLoanPackages(res.data || res.packages || res || [])).catch(()=>setLoanPackages([]));
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [repaymentsData, customersData, agentsData, loansResp] = await Promise.all([
        fetchRepayments({
          status: selectedStatus !== 'All' ? selectedStatus : undefined,
          agentId: selectedAgent !== 'All' ? selectedAgent : undefined,
          search: searchTerm || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          page: currentPage,
          limit: itemsPerPage
        }),
        fetchCustomers(),
        fetchAgents(),
        fetchLoans({ limit: 1000 })
      ]);

      setRepayments(repaymentsData.data || []);
      setTotalPages(repaymentsData.pagination?.totalPages || 1);
      setCustomers(customersData.data || customersData.customers || customersData || []);
      setAgents(agentsData.data || []);
      setLoans(loansResp.loans || loansResp?.data || loansResp || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      Swal.fire('Error', 'Failed to fetch data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const statsData = await fetchRepaymentStats();
      setStats({
        totalCollection: statsData.data?.totalRepayments || 0,
        totalCollectionAmount: statsData.data?.totalAmount || statsData.data?.totalCollection || 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchData();
  };

  const handleStatusUpdate = async (repaymentId: number, newStatus: string) => {
    try {
      await updateRepaymentStatus(repaymentId, { status: newStatus });
      Swal.fire('Success', 'Repayment status updated successfully', 'success');
      fetchData();
      fetchStats();
    } catch (error) {
      console.error('Error updating repayment status:', error);
      Swal.fire('Error', 'Failed to update repayment status', 'error');
    }
  };

  const handleDelete = async (repaymentId: number) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
      try {
        await deleteRepayment(repaymentId);
        Swal.fire('Deleted!', 'Repayment has been deleted.', 'success');
        fetchData();
        fetchStats();
      } catch (error) {
        console.error('Error deleting repayment:', error);
        Swal.fire('Error', 'Failed to delete repayment', 'error');
      }
    }
  };

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
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
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return '—';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed': return 'text-green-600 bg-green-100';
      case 'Pending': return 'text-yellow-600 bg-yellow-100';
      case 'Failed': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (value: string) => {
    setItemsPerPage(parseInt(value));
    setCurrentPage(1);
  };

  // ── Export handlers ───────────────────────────────────────
  const repHeaders = ['Transaction ID', 'Customer', 'Account No.', 'Package', 'Amount', 'Branch', 'Agent', 'Date', 'Status'];
  const getRepRows = () => repayments.map(r => [
    r.transactionId, r.customerName,
    (r as any).accountNumber || (r as any).loan?.accountNumber || 'N/A',
    r.package || 'N/A', formatCurrency(r.amount),
    r.branch || 'N/A', r.agentName || 'N/A', formatDate(r.date), r.status
  ]);
  const handleExportPDF = () => { setShow(false); exportTableToPDF('Loan Repayments', repHeaders, getRepRows(), repayments.length); };
  const handleExportCSV = () => { setShow(false); exportToCSV('Loan_Repayments', repHeaders, getRepRows()); };


  return (
    <div className='w-full'>
      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Loan repayments</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>Monitor and record all loan repayment activities.</p>
        </div>
        <button onClick={() => setIsCreateOpen(true)} className='bg-[#4E37FB] text-white flex items-center gap-2 h-[40px] px-4 rounded-[4px]'>
          <FaPlus className='w-4 h-4' />
          Add repayment
        </button>
      </div>

      <div className='bg-white shadow-sm mt-6 w-full relative'>
        <div>
          <div className="flex flex-wrap flex-col md:flex-row p-4 gap-4 md:gap-0 items-stretch md:items-center justify-between">
            <div className='w-full md:w-[330px]'>
              <p className='pb-2'>Agent</p>
              <Select value={selectedAgent} onValueChange={(value) => setSelectedAgent(value)}>
                <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                  <SelectValue placeholder="All Agents" />
                </SelectTrigger>
                <SelectContent className="w-full md:w-[330px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                  <SelectGroup>
                    <SelectItem value="All" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">All Agents</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id.toString()} className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">
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
              <p className='text-[#737373] font-inter font-normal'>Total repayment</p>
              <h1 className='font-inter font-semibold text-[20px]'>{stats.totalCollection}</h1>
            </div>
            <div className="bg-[#FFF8E5] px-5 py-4 rounded-[4px] w-full md:w-[229px] h-[82px]">
              <p className='text-[#737373] font-inter font-normal'>Total repayment amount</p>
              <h1 className='font-inter font-semibold text-[20px]'>{formatCurrency(stats.totalCollectionAmount)}</h1>
            </div>
          </div>

          <div className='h-[20px] bg-gray-100 w-full mb-1'></div>
        </div>

        <div className='flex flex-wrap flex-col md:flex-row items-center justify-between gap-4 md:gap-10 p-2 md:p-5'>
          <div className='flex flex-wrap flex-col md:flex-row items-center gap-2 md:gap-5 w-full md:w-auto'>

            <div className='relative w-full md:w-auto'>
              <button onClick={() => setFilter(!filter)} className='h-[40px] outline-none leading-[24px] rounded-[4px] w-[90px] border border-[#D0D5DD] flex items-center justify-center gap-[9px] font-inter text-[14px] bg-white  transition-all'>
                <Image src="/icons/filters.svg" alt="filter" width={16} height={16} className="" />
                <p className='font-medium text-[14px]'>Filter</p>
              </button>

              {filter &&
                <div className='fixed md:absolute flex flex-col justify-center  z-50 left-0 right-0 md:left-auto md:right-auto top-0 md:top-auto mx-auto md:mx-0 w-[95%] md:w-[400px] lg:w-[510px] max-w-full md:max-w-[510px] min-w-[230px] md:min-w-[250px] mb-0 md:mb-8 bg-white rounded-b-[8px] md:rounded-[4px] shadow-lg md:p-0' >

                  <div className="flex items-center justify-between max-md:flex-col max-md:gap-[5px] mb-2 md:p-4">
                    <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Choose your filters</h1>
                    <button className='underline text-[14px] text-[#4E37FB] font-inter font-semibold'>Clear filters</button>
                  </div>

                  <div className='border-t-[1px] w-full mb-1'></div>

                  <div className="w-full p-4">
                    <p className='mb-1 font-inter font-semibold text-[14px] leading-[20px]'>Status</p>
                    <div className='flex lg:items-center gap-[10px] mb-6 max-md:flex-col'>
                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="checkbox" 
                          name='completed' 
                          checked={selectedStatus === 'Completed'}
                          onChange={() => setSelectedStatus(selectedStatus === 'Completed' ? 'All' : 'Completed')}
                          className='' 
                        />
                        Completed
                      </div>

                      <div className='flex items-center border gap-[4px] px-3 py-1 rounded-[4px]'>
                        <input 
                          type="checkbox" 
                          name='pending' 
                          checked={selectedStatus === 'Pending'}
                          onChange={() => setSelectedStatus(selectedStatus === 'Pending' ? 'All' : 'Pending')}
                          className='' 
                        />
                        Pending
                      </div>
                    </div>

                    <p className='mb-1 font-inter font-semibold text-[14px] leading-[20px]'>Date</p>

                    <div className='flex gap-[15px]'>
                      <div className="outline-none leading-[24px] rounded-[4px] w-full md:w-[330px] font-inter text-[14px] bg-white transition-all">
                        <p className="text-[12px] font-inter pb-2">From</p>
                        <input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className="w-full h-[40px]  border border-[#D0D5DD] rounded-[4px] font-inter p-1"
                        />
                      </div>
                      <div className="outline-none leading-[24px] rounded-[4px] w-full md:w-[330px] font-inter text-[14px] bg-white transition-all">
                        <p className='text-[12px] font-inter pb-2'>To</p>
                        <input
                          type="date"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className="w-full h-[40px]  border border-[#D0D5DD] rounded-[4px] font-inter p-1"
                        />
                      </div>
                    </div>
                  </div>

                  <div className='border-t-[1px] w-full mb-1  '></div>

                  <div className='flex gap-[8px] justify-end items-end p-2 md:p-4 mb-2 '>
                    <button onClick={() => setFilter(!filter)} className='bg-[#F3F8FF] flex h-[40px] cursor-pointer w-[67px] rounded-[4px] items-center gap-[9px] justify-center'>
                      <p className='text-[14px] font-inter text-[#4E37FB] font-semibold' >Close</p>
                    </button>

                    <button onClick={() => { setFilter(false); handleSearch(); }} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[99px] rounded-[4px] items-center gap-[9px] justify-center'>
                      <p className='text-[14px] font-inter text-white font-medium'>Add filters</p>
                    </button>
                  </div>

                </div>}
            </div>
            <Select onValueChange={handleItemsPerPageChange} value={itemsPerPage.toString()}>
              <SelectTrigger className="h-[40px] outline-none leading-[24px] rounded-[4px] w-full md:w-[185px] border border-[#D0D5DD] font-inter text-[14px] bg-white  transition-all">
                <SelectValue placeholder="Show 10 per row" />
              </SelectTrigger>
              <SelectContent className="w-full md:w-[185px] bg-white mt-1 rounded-[4px] shadow-lg p-0 border-none">
                <SelectGroup>
                  <SelectItem value="10" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Show 10 per row</SelectItem>
                  <SelectItem value="15" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Show 15 per row</SelectItem>
                  <SelectItem value="20" className="px-4 py-2 font-inter text-[13px] text-[#101828] hover:bg-gray-50 cursor-pointer transition-colors rounded-[4px]">Show 20 per row</SelectItem>
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
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="outline-none px-3 py-2 w-full text-sm"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <>
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
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Customer</th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Account number</th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Package</th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                      Amount
                    </th>
                     <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                      <div className="flex items-center gap-[3px]">
                        Branch
                        <div className="flex flex-col gap-[1px] shrink-0">
                          <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                          <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                        </div>
                      </div>
                    </th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">
                      <div className="flex items-center gap-[3px]">
                        Agent
                        <div className="flex flex-col gap-[1px] shrink-0">
                          <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                          <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                        </div>
                      </div>
                    </th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] "><div className="flex items-center gap-[3px]">
                      Date
                      <div className="flex flex-col gap-[1px] shrink-0">
                        <Image src="/icons/uparr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                        <Image src="/icons/downarr.svg" alt="uparrow" width={8} height={8} className="shrink-0" />
                      </div>
                    </div></th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Status</th>
                    <th className="px-5 py-2 text-[12px] leading-[18px] font-lato font-normal text-[#141414] ">Actions</th>
                  </tr>
                </thead>
                <tbody className="border-b border-[#D9D4D4] w-full">
                  {repayments.map((repayment) => (
                    <tr key={repayment.id} className="bg-white transition-all duration-500 hover:bg-gray-50">
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                        {repayment.transactionId}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{repayment.customerName}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{(repayment as any).accountNumber || (repayment as any).customer?.accountNumber || (repayment as any).loan?.accountNumber || 'N/A'}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{repayment.package || 'N/A'}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{formatCurrency(repayment.amount)}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{repayment.branch || 'N/A'}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{repayment.agentName || 'N/A'}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">{formatDate(repayment.date)}</td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(repayment.status)}`}>
                          {repayment.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-[14px] leading-[20px] font-lato font-normal ">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDelete(repayment.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete"
                          >
                            <FaTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>

              </table>
              
              {/* Mobile stacked rows */}
              {repayments.map((repayment) => (
                <div key={repayment.id} className="md:hidden block border-b p-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm text-gray-600"><span>Transaction ID:</span><span className="font-semibold">{repayment.transactionId}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Customer:</span><span className="font-semibold">{repayment.customerName}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Account number:</span><span className="font-semibold">{(repayment as any).accountNumber || (repayment as any).customer?.accountNumber || (repayment as any).loan?.accountNumber || 'N/A'}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Package:</span><span className="font-semibold">{repayment.package || 'N/A'}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Amount:</span><span className="font-semibold">{formatCurrency(repayment.amount)}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Branch:</span><span className="font-semibold">{repayment.branch || 'N/A'}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Agent:</span><span className="font-semibold">{repayment.agentName || 'N/A'}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Date:</span><span className="font-semibold">{formatDate(repayment.date)}</span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Status:</span><span className="font-semibold">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(repayment.status)}`}>
                        {repayment.status}
                      </span>
                    </span></div>
                    <div className="flex justify-between text-sm text-gray-600"><span>Actions:</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDelete(repayment.id)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete"
                        >
                          <FaTrash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className='border-t w-full mt-5'></div>
            <div className="flex flex-wrap flex-col md:flex-row pb-4 justify-between items-center gap-2 mt-4 px-2 md:px-6">
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
                <span>Page {currentPage} of {totalPages}</span>
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
          </>
        )}
      </div>

      {isCreateOpen && (
        <CreateRepaymentModal 
          onClose={() => setIsCreateOpen(false)} 
          onSuccess={() => { setIsCreateOpen(false); fetchData(); fetchStats(); }} 
          customers={customers}
          agents={agents}
          loans={loans}
          loanPackages={loanPackages}
        />
      )}

    </div>
  )
}

export default Page