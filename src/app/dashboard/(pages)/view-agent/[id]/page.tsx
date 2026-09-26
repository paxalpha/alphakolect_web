"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, MoreHorizontal, User, Phone, Mail, MapPin, Calendar, Shield, TrendingUp, Users, DollarSign, Activity, CreditCard, Landmark } from 'lucide-react';
import '../../../../../../global.css';
import { useParams, useRouter } from 'next/navigation';
import {
  fetchAgentById,
  updateAgentStatus,
  fetchCustomers,
  fetchCollections,
  fetchLoans,
  fetchInvestmentTransactions,
} from '../../../../../../services/api';
import Swal from 'sweetalert2';

interface Customer {
  id: number;
  accountNumber?: string;
  fullName: string;
  phoneNumber: string;
  packageName?: string;
  createdAt?: string;
  status?: string;
}

interface Collection {
  id: number;
  customerId?: number;
  customerName?: string;
  amount?: number;
  date?: string;
  status?: string;
  agentId?: number;
}

interface Loan {
  id: number;
  customerId?: number;
  customerName?: string;
  loanAmount?: number;
  totalAmount?: number;
  remainingAmount?: number;
  status?: string;
  dateIssued?: string;
}

interface InvTx {
  id: number;
  customerId?: number;
  customer?: string;
  amount?: number;
  transactionType?: string;
  status?: string;
  transactionDate?: string;
}

interface AgentData {
  id?: number;
  fullName: string;
  phoneNumber: string;
  email: string;
  branch: string;
  dateCreated: string;
  status: 'Active' | 'Inactive';
}

const fmt = (n: number) => {
  try { return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  catch { return '₦' + n; }
};

const parseAmt = (v: any): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = parseFloat(v.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  return 0;
};

const fmtDate = (d?: string) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
};

type Tab = 'customers' | 'collections' | 'loans' | 'investments';

const AgentProfilePage = () => {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params?.id && !isNaN(Number(params.id)) ? Number(params.id) : undefined;

  const [agent, setAgent] = useState<AgentData>({ fullName: '', phoneNumber: '', email: '', branch: '', dateCreated: '', status: 'Active' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [investments, setInvestments] = useState<InvTx[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>('customers');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const agentRes = await fetchAgentById(agentId);
        const a = (agentRes as any)?.agent || agentRes;
        if (alive) setAgent({
          id: a.id,
          fullName: a.fullName || '',
          phoneNumber: a.phoneNumber || '',
          email: a.email || '',
          branch: a.branch || '',
          dateCreated: a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
          status: (a.status || 'Active') as 'Active' | 'Inactive',
        });

        const [custRes, collRes, loansRes, invRes] = await Promise.all([
          fetchCustomers({ agentId: String(agentId) }).catch(() => ({})),
          fetchCollections({ agentId: String(agentId) } as any).catch(() => ({})),
          fetchLoans({ agentId: String(agentId), limit: 1000 }).catch(() => ({})),
          fetchInvestmentTransactions({ agentId: String(agentId), limit: 1000 }).catch(() => ({})),
        ]);

        const custArr: any[] = (custRes as any)?.customers || (custRes as any)?.data || [];
        const collArr: any[] = (collRes as any)?.collections || (collRes as any)?.data || [];
        const loansArr: any[] = (loansRes as any)?.data || (loansRes as any)?.loans || [];
        const invArr: any[] = (invRes as any)?.transactions || (invRes as any)?.data || (Array.isArray(invRes) ? invRes : []);

        if (alive) {
          setCustomers(custArr.map((c: any) => ({
            id: c.id,
            accountNumber: c.accountNumber || '—',
            fullName: c.fullName || c.name || '—',
            phoneNumber: c.phoneNumber || '—',
            packageName: c.packageName || c.Package?.name || '—',
            createdAt: c.createdAt,
            status: c.status || 'Active',
          })));

          setCollections(collArr.map((c: any) => ({
            id: c.id,
            customerId: c.customerId,
            customerName: c.customerName || c.customer?.fullName || '—',
            amount: parseAmt(c.amount),
            date: c.date || c.createdAt,
            status: c.status || 'Pending',
            agentId: c.agentId,
          })));

          setLoans(loansArr.map((l: any) => ({
            id: l.id,
            customerId: l.customerId,
            customerName: l.customerName || l.customer?.fullName || '—',
            loanAmount: parseAmt(l.loanAmount),
            totalAmount: parseAmt(l.totalAmount),
            remainingAmount: parseAmt(l.remainingAmount),
            status: l.status || '—',
            dateIssued: l.dateIssued,
          })));

          setInvestments(invArr.map((t: any) => ({
            id: t.id,
            customerId: t.customerId || t.customer?.id,
            customer: t.customerName || t.customer?.fullName || '—',
            amount: parseAmt(t.amount),
            transactionType: t.transactionType || '—',
            status: t.status || '—',
            transactionDate: t.transactionDate || t.createdAt,
          })));
        }
      } catch (e: any) {
        if (alive) setError(e?.message || 'Failed to load agent data');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [agentId]);

  // Stats
  const todayStr = new Date().toISOString().slice(0, 10);
  const totalCollections = collections.reduce((s, c) => s + (c.amount || 0), 0);
  const todayCollections = collections.filter(c => (c.date || '').slice(0, 10) === todayStr).reduce((s, c) => s + (c.amount || 0), 0);
  const totalLoanAmount = loans.reduce((s, l) => s + (l.loanAmount || 0), 0);
  const totalInvAmount = investments.filter(t => t.transactionType === 'deposit').reduce((s, t) => s + (t.amount || 0), 0);

  const handleDeactivate = async () => {
    if (!agentId) return;
    const next = agent.status === 'Active' ? 'Inactive' : 'Active';
    const result = await Swal.fire({
      title: `${next === 'Inactive' ? 'Deactivate' : 'Activate'} agent?`,
      text: `This will mark ${agent.fullName} as ${next}.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: next === 'Inactive' ? '#ef4444' : '#4f46e5',
      confirmButtonText: `Yes, ${next === 'Inactive' ? 'deactivate' : 'activate'}`,
    });
    if (!result.isConfirmed) return;
    try {
      await updateAgentStatus(agentId, next);
      setAgent(prev => ({ ...prev, status: next }));
      Swal.fire('Done!', `Agent is now ${next}.`, 'success');
    } catch (e: any) {
      Swal.fire('Error', e.message || 'Failed to update status', 'error');
    }
  };

  const handleExport = (format: string) => {
    if (format === 'CSV') {
      let headers: string[] = []
      let rows: any[][] = []
      let filename = `agent_${agentId}_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`;

      if (activeTab === 'customers') {
        headers = ['Account No.', 'Full Name', 'Phone', 'Package', 'Date Joined', 'Status'];
        rows = tableData.map((c) => [
          c.accountNumber || '',
          c.fullName || '',
          c.phoneNumber || '',
          c.packageName || '',
          c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
          c.status || ''
        ]);
      } else if (activeTab === 'collections') {
        headers = ['Customer', 'Amount', 'Date', 'Status'];
        rows = tableData.map((c) => [
          c.customerName || '',
          c.amount || 0,
          c.date ? new Date(c.date).toLocaleDateString() : '',
          c.status || ''
        ]);
      } else if (activeTab === 'loans') {
        headers = ['Customer', 'Loan Amount', 'Total', 'Remaining', 'Status', 'Date'];
        rows = tableData.map((l) => [
          l.customerName || '',
          l.loanAmount || 0,
          l.totalAmount || 0,
          l.remainingAmount || 0,
          l.status || '',
          l.dateIssued ? new Date(l.dateIssued).toLocaleDateString() : ''
        ]);
      } else if (activeTab === 'investments') {
        headers = ['Customer', 'Amount', 'Type', 'Status', 'Date'];
        rows = tableData.map((t) => [
          t.customer || '',
          t.amount || 0,
          t.transactionType || '',
          t.status || '',
          t.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : ''
        ]);
      }

      if (rows.length === 0) {
        Swal.fire('Info', 'No data to export', 'info');
        return;
      }

      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } else if (format === 'PDF') {
      window.print();
    }
  };

  // Table data
  const tableData = useMemo(() => {
    const source: any[] = activeTab === 'customers' ? customers : activeTab === 'collections' ? collections : activeTab === 'loans' ? loans : investments;
    const term = search.toLowerCase();
    return source.filter((item: any) => {
      const text = JSON.stringify(item).toLowerCase();
      const matchSearch = !term || text.includes(term);
      const matchStatus = !statusFilter || (item.status || '').toLowerCase() === statusFilter.toLowerCase();
      return matchSearch && matchStatus;
    });
  }, [activeTab, customers, collections, loans, investments, search, statusFilter]);

  const totalPages = Math.ceil(tableData.length / rowsPerPage);
  const pageItems = tableData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      Active: 'bg-green-100 text-green-800',
      completed: 'bg-blue-100 text-blue-800',
      Completed: 'bg-blue-100 text-blue-800',
      Paid: 'bg-green-100 text-green-800',
      paid: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      Pending: 'bg-yellow-100 text-yellow-800',
      inactive: 'bg-gray-100 text-gray-600',
      Inactive: 'bg-gray-100 text-gray-600',
      Defaulted: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-700'}`}>
        {status}
      </span>
    );
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'customers', label: 'Customers', count: customers.length },
    { key: 'collections', label: 'Collections', count: collections.length },
    { key: 'loans', label: 'Loans', count: loans.length },
    { key: 'investments', label: 'Investment Txns', count: investments.length },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-indigo-600 mb-1">&larr; Back</button>
          <h1 className="text-2xl font-bold text-gray-900">{loading ? 'Loading...' : agent.fullName || 'Agent Profile'}</h1>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleDeactivate}
            className={`px-4 py-2 text-sm font-medium rounded-lg shadow-sm transition-colors ${
              agent.status === 'Active'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {agent.status === 'Active' ? 'Deactivate' : 'Activate'} Account
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {/* Agent Profile Card */}
        <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center mb-3">
              <User className="w-10 h-10 text-indigo-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{agent.fullName || '—'}</h2>
            <span className={`mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              agent.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {agent.status}
            </span>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
              <Phone className="w-4 h-4 shrink-0 text-indigo-400" />
              <span>{agent.phoneNumber || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Mail className="w-4 h-4 shrink-0 text-indigo-400" />
              <span className="truncate">{agent.email || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <MapPin className="w-4 h-4 shrink-0 text-indigo-400" />
              <span>{agent.branch || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="w-4 h-4 shrink-0 text-indigo-400" />
              <span>Joined {agent.dateCreated || '—'}</span>
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: "Total Customers", value: customers.length.toLocaleString(), icon: Users, color: "bg-blue-50 border-blue-200", iconColor: "text-blue-500" },
            { label: "Total Collections", value: fmt(totalCollections), icon: DollarSign, color: "bg-green-50 border-green-200", iconColor: "text-green-500" },
            { label: "Today's Collections", value: fmt(todayCollections), icon: Activity, color: "bg-yellow-50 border-yellow-200", iconColor: "text-yellow-500" },
            { label: "Total Loans Disbursed", value: fmt(totalLoanAmount), icon: CreditCard, color: "bg-indigo-50 border-indigo-200", iconColor: "text-indigo-500" },
            { label: "Investment Deposits", value: fmt(totalInvAmount), icon: TrendingUp, color: "bg-purple-50 border-purple-200", iconColor: "text-purple-500" },
            { label: "Active Loans", value: loans.filter(l => l.status === 'Active').length.toLocaleString(), icon: Landmark, color: "bg-red-50 border-red-200", iconColor: "text-red-500" },
          ].map(({ label, value, icon: Icon, color, iconColor }) => (
            <div key={label} className={`bg-white rounded-xl shadow-sm border p-5 ${color}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="text-xl font-bold text-gray-900">{loading ? '—' : value}</p>
                </div>
                <Icon className={`w-7 h-7 ${iconColor} opacity-80`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setCurrentPage(1); setSearch(''); setStatusFilter(''); }}
              className={`py-4 px-6 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === key ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                activeTab === key ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
              }`}>{count}</span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="p-4 flex flex-col sm:flex-row gap-3 items-center justify-between border-b border-gray-100">
          <div className="flex gap-3 w-full sm:w-auto">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Search..."
                className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-56"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
            >\n              <option value="">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
              <option value="Defaulted">Defaulted</option>
            </select>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative bg-[#e9e6ff] text-indigo-500 rounded-lg">
              <select
                className="block bg-[#e9e6ff] appearance-none rounded-lg text-indigo-500 pl-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                defaultValue=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) handleExport(val);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>Export</option>
                <option value="PDF">PDF</option>
                <option value="CSV">CSV</option>
              </select>
            </div>
            <select
              value={rowsPerPage}
              onChange={e => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {[10, 25, 50].map(n => <option key={n} value={n}>Show {n}</option>)}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="text-center py-16 text-gray-400">Loading data...</div>
          ) : pageItems.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No records found.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {activeTab === 'customers' && [
                    'Account No.', 'Full Name', 'Phone', 'Package', 'Date Joined', 'Status', 'Action'
                  ].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>)}
                  {activeTab === 'collections' && [
                    'Customer', 'Amount', 'Date', 'Status', 'Action'
                  ].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>)}
                  {activeTab === 'loans' && [
                    'Customer', 'Loan Amount', 'Total', 'Remaining', 'Status', 'Date', 'Action'
                  ].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>)}
                  {activeTab === 'investments' && [
                    'Customer', 'Amount', 'Type', 'Status', 'Date', 'Action'
                  ].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>)}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {pageItems.map((item: any) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    {activeTab === 'customers' && (
                      <>
                        <td className="px-4 py-3 text-sm text-gray-800 font-mono">{item.accountNumber}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.fullName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.phoneNumber}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.packageName}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(item.createdAt)}</td>
                        <td className="px-4 py-3"><StatusBadge status={item.status || 'Active'} /></td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => router.push(`/dashboard/customer/${item.id}`)}
                            className="text-xs px-3 py-1.5 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50"
                          >View</button>
                        </td>
                      </>
                    )}
                    {activeTab === 'collections' && (
                      <>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.customerName}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 font-semibold">{fmt(item.amount || 0)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(item.date)}</td>
                        <td className="px-4 py-3"><StatusBadge status={item.status || 'Pending'} /></td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => item.customerId && router.push(`/dashboard/customer/${item.customerId}`)}
                            className="text-xs px-3 py-1.5 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50"
                          >View</button>
                        </td>
                      </>
                    )}
                    {activeTab === 'loans' && (
                      <>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.customerName}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 font-semibold">{fmt(item.loanAmount || 0)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{fmt(item.totalAmount || 0)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{fmt(item.remainingAmount || 0)}</td>
                        <td className="px-4 py-3"><StatusBadge status={item.status || '—'} /></td>
                        <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(item.dateIssued)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => item.customerId && router.push(`/dashboard/customer/${item.customerId}`)}
                            className="text-xs px-3 py-1.5 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50"
                          >View</button>
                        </td>
                      </>
                    )}
                    {activeTab === 'investments' && (
                      <>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.customer}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 font-semibold">{fmt(item.amount || 0)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 capitalize">{item.transactionType}</td>
                        <td className="px-4 py-3"><StatusBadge status={item.status || '—'} /></td>
                        <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(item.transactionDate)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => item.customerId && router.push(`/dashboard/customer/${item.customerId}`)}
                            className="text-xs px-3 py-1.5 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50"
                          >View</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 flex items-center justify-between border-t border-gray-100">
            <p className="text-sm text-gray-500">Showing {(currentPage - 1) * rowsPerPage + 1}–{Math.min(currentPage * rowsPerPage, tableData.length)} of {tableData.length}</p>
            <div className="flex gap-2">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">Previous</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, currentPage - 2);
                const page = start + i;
                if (page > totalPages) return null;
                return (
                  <button key={page} onClick={() => setCurrentPage(page)} className={`w-8 h-8 text-sm rounded-lg font-medium ${
                    page === currentPage ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>{page}</button>
                );
              })}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentProfilePage;
