"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Search, Pencil, Ellipsis, ArrowRight, ArrowLeft, ChevronUp, ChevronDown, X } from 'lucide-react';

// Interfaces for data and component props
interface Charge {
  id: number;
  chargeName: string;
  type: string;
  amount: string;
  activeCustomers: number;
  lastUpdated: string;
}

interface HistoryItem {
  id: number;
  customerName: string;
  accountNumber: string;
  chargeName: string;
  amount: string;
  dueDate: string;
  dateApplied: string;
  status: string;
}

interface SortConfig {
  key: string | null;
  direction: 'ascending' | 'descending';
}

// Generic props for the SortableHeader component
interface SortableHeaderProps<T> {
  title: string;
  sortKey: keyof T;
  sortConfig: SortConfig;
  onSort: (key: keyof T) => void;
}

interface ChargesTableProps {
  data: Charge[];
  sortConfig: SortConfig;
  onSort: (key: keyof Charge) => void;
  rowsPerPage: number;
  searchTerm: string;
}

interface ChargesHistoryTableProps {
  data: HistoryItem[];
  sortConfig: SortConfig;
  onSort: (key: keyof HistoryItem) => void;
  rowsPerPage: number;
  searchTerm: string;
  statusFilter: string;
  onMarkAsPaid: (id: number) => void;
}

// Sidebar component props
interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

// Reusable generic component for sortable table headers
const SortableHeader = <T,>({ title, sortKey, sortConfig, onSort }: SortableHeaderProps<T>) => {
  const isSorted = sortConfig.key === sortKey;
  const isAscending = isSorted && sortConfig.direction === 'ascending';
  const isDescending = isSorted && sortConfig.direction === 'descending';

  return (
    <th
      className="p-4 text-left text-sm font-medium text-gray-500 cursor-pointer select-none"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        <span>{title}</span>
        <div className="flex flex-col">
          <ChevronUp
            size={12}
            className={`transition-colors duration-200 ${isAscending ? 'text-indigo-600' : 'text-gray-400'}`}
          />
          <ChevronDown
            size={12}
            className={`transition-colors duration-200 ${isDescending ? 'text-indigo-600' : 'text-gray-400'}`}
          />
        </div>
      </div>
    </th>
  );
};

// Reusable Sidebar component
const Sidebar: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
    return (
        <div
            className={`fixed inset-0 z-50 transform ${
                isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
            } transition-transform duration-300 ease-in-out`}
        >
            {/* Overlay */}
            <div
                className="absolute inset-0 transition-opacity duration-300 bg-gray-900 bg-opacity-50"
                onClick={onClose}
            ></div>
            {/* Sidebar content */}
            <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col pointer-events-auto">
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">{title}</h2>
                    <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors duration-200">
                        <X size={24} />
                    </button>
                </div>
                <div className="flex-grow p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

// Create Charge Sidebar Content
const CreateChargeSidebar: React.FC<{ isOpen: boolean; onClose: () => void; onSuccess: () => void }> = ({ isOpen, onClose, onSuccess }) => {
    const [chargeName, setChargeName] = useState('');
    const [chargeType, setChargeType] = useState('');
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const handleCreate = async () => {
        setLoading(true);
        try {
            await createCharge({
                chargeName,
                type: chargeType,
                amount,
            });
            
            Swal.fire({
                icon: 'success',
                title: 'Charge Created',
                text: 'Charge has been created successfully.',
            });
            
            setChargeName('');
            setChargeType('');
            setAmount('');
            onSuccess();
            onClose();
        } catch (error: any) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to create charge.',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Sidebar isOpen={isOpen} onClose={onClose} title="Create charges">
            <div className="space-y-6">
                <div>
                    <label htmlFor="chargeName" className="block text-sm font-medium text-gray-700">Charge name</label>
                    <input
                        type="text"
                        name="chargeName"
                        id="chargeName"
                        value={chargeName}
                        onChange={(e) => setChargeName(e.target.value)}
                        placeholder="Enter name"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        style={{outline: 'none'}}
                    />
                </div>
                <div>
                    <label htmlFor="chargeType" className="block text-sm font-medium text-gray-700">Type</label>
                    <select
                        id="chargeType"
                        name="chargeType"
                        value={chargeType}
                        onChange={(e) => setChargeType(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        style={{outline: 'none'}}
                    >
                        <option value="">Select type</option>
                        <option value="Loan">Loan</option>
                        <option value="Penalty">Penalty</option>
                        <option value="Service">Service</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="amount" className="block text-sm font-medium text-gray-700">Amount</label>
                    <input
                        type="text"
                        name="amount"
                        id="amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="N0.00"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        style={{outline: 'none'}}
                    />
                </div>
            </div>
            <div className="mt-8">
                <button
                    onClick={handleCreate}
                    disabled={loading}
                    className={`w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-indigo-700 active:scale-[.98] ${loading ? 'opacity-80 cursor-not-allowed' : ''}`}
                >
                    {loading && (
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                    {loading ? 'Creating...' : 'Create charges'}
                </button>
            </div>
        </Sidebar>
    );
};

// Assign Charge Sidebar Content
const AssignChargeSidebar: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void;
  onSuccess: () => void;
  charges: Charge[];
  customers: any[];
  initial?: { chargeName?: string; amount?: string; dueDate?: string; customer?: string };
}> = ({ isOpen, onClose, onSuccess, charges, customers, initial }) => {
    const [chargeName, setChargeName] = useState(initial?.chargeName || '');
    const [amount, setAmount] = useState(initial?.amount || '');
    const [dueDate, setDueDate] = useState(initial?.dueDate || '');
    const [customer, setCustomer] = useState(initial?.customer || '');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (isOpen) {
        setChargeName(initial?.chargeName || '');
        setAmount(initial?.amount || '');
        setDueDate(initial?.dueDate || '');
        setCustomer(initial?.customer || '');
      }
    }, [isOpen, initial?.chargeName, initial?.amount, initial?.dueDate, initial?.customer]);

    const handleAssign = async () => {
        if (!chargeName || !amount || !dueDate || !customer) {
          Swal.fire({ icon: 'error', title: 'All fields are required' });
          return;
        }
        setLoading(true);
        try {
          await assignCharge({ chargeName, amount, dueDate, customer });
          Swal.fire({ icon: 'success', title: 'Charge assigned' });
          onSuccess();
          onClose();
        } catch (err:any) {
          Swal.fire({ icon: 'error', title: 'Failed', text: err?.message || 'Failed to assign charge' });
        } finally {
          setLoading(false);
        }
    };

    return (
        <Sidebar isOpen={isOpen} onClose={onClose} title="Assign charges">
            <div className="space-y-6">
                <div>
                    <label htmlFor="assignChargeName" className="block text-sm font-medium text-gray-700">Charge name</label>
                    <select
                        id="assignChargeName"
                        name="assignChargeName"
                        value={chargeName}
                        onChange={(e) => {
                            const val = e.target.value;
                            setChargeName(val);
                            if (val) {
                                const selected = charges.find(c => c.chargeName === val);
                                if (selected) {
                                    setAmount(String(selected.amount).replace(/[^0-9.]/g, ''));
                                }
                            } else {
                                setAmount('');
                            }
                        }}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        style={{outline: 'none'}}
                    >
                        <option value="">Select charge</option>
                        {charges.map((c) => (
                          <option key={c.id} value={c.chargeName}>{c.chargeName}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="assignAmount" className="block text-sm font-medium text-gray-700">Amount</label>
                    <input
                        type="text"
                        name="assignAmount"
                        id="assignAmount"
                        value={amount}
                        readOnly
                        placeholder="N0.00"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                        style={{outline: 'none'}}
                    />
                </div>
                <div>
                    <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">Due date</label>
                    <input
                        type="date"
                        name="dueDate"
                        id="dueDate"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        style={{outline: 'none'}}
                    />
                </div>
                <div>
                    <label htmlFor="customer" className="block text-sm font-medium text-gray-700">Customer(s)</label>
                    <select
                        id="customer"
                        name="customer"
                        value={customer}
                        onChange={(e) => setCustomer(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        style={{outline: 'none'}}
                    >
                        <option value="">Select customer</option>
                        {customers.map((cust:any) => (
                          <option key={cust.id} value={cust.fullName}>{cust.fullName}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="mt-8">
                <button
                    onClick={handleAssign}
                    disabled={loading}
                    className={`w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-indigo-700 ${loading ? 'opacity-80 cursor-not-allowed' : ''}`}
                >
                    {loading && (
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                    {loading ? 'Assigning...' : 'Assign charges'}
                </button>
            </div>
        </Sidebar>
    );
};

// Import API functions
import { fetchCharges, fetchChargeHistory, createCharge, assignCharge, fetchCustomers, updateCharge, updateChargeAssignmentStatus } from '../../../../../services/api';
import Swal from 'sweetalert2';

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const isPaid = status === 'Paid';
  const colorClass = isPaid ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {status}
    </span>
  );
};

const ChargesTable: React.FC<ChargesTableProps & { onEdit: (row: Charge) => void }> = ({ data, sortConfig, onSort, rowsPerPage, searchTerm, onEdit }) => {
  const filteredData = data.filter(item =>
    Object.values(item).some(value =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-left">
        <thead className="bg-gray-50">
          <tr>
            <SortableHeader<Charge>
              title="Charge name"
              sortKey="chargeName"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<Charge>
              title="Type"
              sortKey="type"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<Charge>
              title="Amount"
              sortKey="amount"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<Charge>
              title="Active customer assigned"
              sortKey="activeCustomers"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<Charge>
              title="Last updated"
              sortKey="lastUpdated"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <th className="p-4 text-right"></th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {filteredData.slice(0, rowsPerPage).length > 0 ? (
            filteredData.slice(0, rowsPerPage).map((row) => (
              <tr key={row.id}>
                <td className="p-4 text-sm font-medium text-gray-900">{row.chargeName}</td>
                <td className="p-4 text-sm text-gray-500">{row.type}</td>
                <td className="p-4 text-sm text-gray-500">{row.amount}</td>
                <td className="p-4 text-sm text-gray-500">{row.activeCustomers}</td>
                <td className="p-4 text-sm text-gray-500">{row.lastUpdated}</td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => onEdit(row)} className="p-2 rounded hover:bg-gray-100 transition-colors duration-200" aria-label="Edit">
                      <img src="/icons/lucide_edit.svg" alt="Edit" />
                    </button>
                    <button className="p-2 rounded hover:bg-gray-100 transition-colors duration-200" aria-label="More">
                      <img src="/icons/dots-bold.svg" alt="More" />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="p-4 text-center text-gray-500">
                No results found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const ChargesHistoryTable: React.FC<ChargesHistoryTableProps> = ({ data, sortConfig, onSort, rowsPerPage, searchTerm, statusFilter, onMarkAsPaid }) => {
  const filteredData = data.filter(item => {
    const matchesSearch = Object.values(item).some(value =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    );
    const matchesStatus = statusFilter === 'All status' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-left">
        <thead className="bg-gray-50">
          <tr>
            <SortableHeader<HistoryItem>
              title="Customer name"
              sortKey="customerName"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<HistoryItem>
              title="Account number"
              sortKey="accountNumber"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<HistoryItem>
              title="Charge name"
              sortKey="chargeName"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<HistoryItem>
              title="Amount"
              sortKey="amount"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<HistoryItem>
              title="Due date"
              sortKey="dueDate"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<HistoryItem>
              title="Date applied"
              sortKey="dateApplied"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <SortableHeader<HistoryItem>
              title="Status"
              sortKey="status"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            <th className="p-4 text-right"></th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {filteredData.slice(0, rowsPerPage).length > 0 ? (
            filteredData.slice(0, rowsPerPage).map((row) => (
              <tr key={row.id}>
                <td className="p-4 text-sm font-medium text-gray-900">{row.customerName}</td>
                <td className="p-4 text-sm text-gray-500">{row.accountNumber}</td>
                <td className="p-4 text-sm text-gray-500">{row.chargeName}</td>
                <td className="p-4 text-sm text-gray-500">{row.amount}</td>
                <td className="p-4 text-sm text-gray-500">{row.dueDate}</td>
                <td className="p-4 text-sm text-gray-500">{row.dateApplied}</td>
                <td className="p-4 text-sm text-gray-500">
                  <StatusPill status={row.status} />
                </td>
                <td className="p-4 text-right">
                  <div className="relative inline-block text-left">
                    <details>
                      <summary className="list-none cursor-pointer inline-flex items-center justify-center p-2 rounded hover:bg-gray-100 transition-colors duration-200">
                        <img src="/icons/dots-bold.svg" alt="Options" />
                      </summary>
                      <div className="absolute right-0 mt-2 w-40 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
                        <button 
                          disabled={row.status === 'Paid'}
                          onClick={() => onMarkAsPaid(row.id)}
                          className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 ${row.status === 'Paid' ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          Mark as Paid
                        </button>
                        <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Reassign</button>
                      </div>
                    </details>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="p-4 text-center text-gray-500">
                No results found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};


const App = () => {
  const [activeTab, setActiveTab] = useState('Charges');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'ascending' });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All status');
  const [isCreateChargeSidebarOpen, setIsCreateChargeSidebarOpen] = useState(false);
  const [isAssignChargeSidebarOpen, setIsAssignChargeSidebarOpen] = useState(false);
  const [chargesData, setChargesData] = useState<Charge[]>([]);
  const [historyData, setHistoryData] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<any[]>([]);
  const [reassignInitial, setReassignInitial] = useState<{ chargeName?: string; amount?: string; dueDate?: string; customer?: string }|undefined>(undefined);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editState, setEditState] = useState<{ id: number; chargeName: string; type: string; amount: string }>({ id: 0, chargeName: '', type: '', amount: '' });

  // Fetch data from API
  const fetchData = async () => {
    setLoading(true);
    try {
      const [chargesRes, historyRes, customersRes] = await Promise.all([
        fetchCharges(),
        fetchChargeHistory(),
        fetchCustomers()
      ]);
      
      setChargesData((chargesRes as any).charges || []);
      setHistoryData((historyRes as any).history || []);
      setCustomers((customersRes as any).customers || []);
    } catch (error: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to fetch charges data.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  React.useEffect(() => {
    fetchData();
  }, []);

  const data = activeTab === 'Charges' ? chargesData : historyData;

  const sortedData = useMemo(() => {
    let sortableData = [...data];
    if (sortConfig.key !== null) {
      sortableData.sort((a: any, b: any) => {
        const key = sortConfig.key as keyof (Charge | HistoryItem);
        if (a[key] < b[key]) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (a[key] > b[key]) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableData;
  }, [data, sortConfig]);

  const filteredData = useMemo(() => {
    let currentData = sortedData;
    if (activeTab === 'Charges') {
      return currentData.filter(item =>
        Object.values(item).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    } else { // Charges history
      return currentData.filter((item:any) => {
        const matchesSearch = Object.values(item).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        );
        const matchesStatus = statusFilter === 'All status' || item.status === statusFilter;
        return matchesSearch && matchesStatus;
      });
    }
  }, [sortedData, searchTerm, activeTab, statusFilter]);

  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const requestSort = <T extends Charge | HistoryItem>(key: keyof T) => {
    let direction:any = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key: key as string, direction });
  };

  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(Number(e.target.value));
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const renderPaginationButtons = () => {
    const buttons = [];
    const maxButtons = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    const endPage = Math.min(totalPages, startPage + maxButtons - 1);

    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button
          key={i}
          className={`px-3 py-1 rounded-md text-sm font-medium ${
            currentPage === i
              ? 'bg-indigo-600 text-white'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
          onClick={() => handlePageChange(i)}
        >
          {i}
        </button>
      );
    }

    if (startPage > 1) {
      buttons.unshift(
        <span key="ellipsis-start" className="px-2 text-gray-500">...</span>
      );
    }
    if (endPage < totalPages) {
      buttons.push(
        <span key="ellipsis-end" className="px-2 text-gray-500">...</span>
      );
    }

    return buttons;
  };

  return (
    <div className="bg-gray-50 min-h-screen font-sans antialiased">
      <div className="max-w-7xl mx-auto pt-3">
        {/* Header Section */}
        <div className="flex flex-col px-5 md:flex-row md:justify-between md:items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Charges</h1>
            <p className="text-gray-500 mt-1">
              Create charges and add charges to the customers who needs to pay them.
            </p>
          </div>
          <div className="flex flex-col gap-4 mt-4 md:mt-0 md:flex-row">
            <button
              onClick={() => setIsCreateChargeSidebarOpen(true)}
              className="bg-white text-indigo-600 border border-gray-300 rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-gray-50 active:scale-[.98]"
            >
              <Plus size={18} />
              Create charges
            </button>
            <button
              onClick={() => { setReassignInitial(undefined); setIsAssignChargeSidebarOpen(true); }}
              className="bg-indigo-600 text-white rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-indigo-700 active:scale-[.98]"
            >
              <Plus size={18} />
              Assign charges
            </button>
          </div>
        </div>

        {/* Tabs and Controls */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center border-b border-gray-200 mb-6">
            <button
              className={`pb-4 px-4 text-sm font-medium ${
                activeTab === 'Charges'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => {
                setActiveTab('Charges');
                setSortConfig({ key: null, direction: 'ascending' });
                setCurrentPage(1);
              }}
            >
              Charges
            </button>
            <button
              className={`pb-4 px-4 text-sm font-medium ${
                activeTab === 'Charges history'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => {
                setActiveTab('Charges history');
                setSortConfig({ key: null, direction: 'ascending' });
                setCurrentPage(1);
              }}
            >
              Charges history
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between mb-6 gap-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
              {activeTab === 'Charges history' && (
                <div className="relative w-full sm:w-auto">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none cursor-pointer"
                  >
                    <option value="All status">All status</option>
                    <option value="Pending">Pending</option>
                    <option value="Paid">Paid</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                    <ChevronDown className="h-5 w-5" />
                  </div>
                </div>
              )}
              <div className="relative w-full sm:w-auto">
                <select
                  className="block w-full rounded-lg border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none cursor-pointer"
                  value={rowsPerPage}
                  onChange={handleRowsPerPageChange}
                >
                  <option value={10}>Show 10 per row</option>
                  <option value={20}>Show 20 per row</option>
                  <option value={50}>Show 50 per row</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                  <ChevronDown className="h-5 w-5" />
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
              <button onClick={() => setIsAssignChargeSidebarOpen(true)} className="bg-white text-gray-700 border border-gray-300 rounded-lg px-4 py-2.5 shadow-sm font-medium text-sm transition-all duration-200 hover:bg-gray-50 active:scale-[.98] w-full sm:w-auto">
                Reassign
              </button>
              <div className="relative w-full sm:w-64">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Table */}
          {activeTab === 'Charges' ? (
            <ChargesTable
              data={paginatedData as Charge[]}
              sortConfig={sortConfig}
              onSort={requestSort as (key: keyof Charge) => void}
              rowsPerPage={rowsPerPage}
              searchTerm={searchTerm}
              onEdit={(row) => { setEditState({ id: row.id, chargeName: row.chargeName, type: row.type, amount: row.amount.replace(/[^\d.-]/g,'') }); setIsEditOpen(true); }}
            />
          ) : (
            <ChargesHistoryTable
              data={paginatedData as HistoryItem[]}
              sortConfig={sortConfig}
              onSort={requestSort as (key: keyof HistoryItem) => void}
              rowsPerPage={rowsPerPage}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onMarkAsPaid={async (id) => {
                try {
                  const result = await Swal.fire({
                    title: 'Confirm Payment',
                    text: 'Are you sure you want to mark this charge as paid? This will deduct the amount from the customer collection wallet.',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, Mark as Paid',
                    confirmButtonColor: '#4f46e5'
                  });

                  if (result.isConfirmed) {
                    await updateChargeAssignmentStatus(id, 'Paid');
                    Swal.fire({ icon: 'success', title: 'Charge marked as paid' });
                    fetchData();
                  }
                } catch (err: any) {
                  Swal.fire({ icon: 'error', title: 'Failed', text: err?.message || 'Failed to update charge status' });
                }
              }}
            />
          )}

          {/* Pagination */}
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-lg transition-colors duration-200 ${
                currentPage === 1
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <ArrowLeft size={16} /> Previous
            </button>
            <div className="flex items-center space-x-1">
              {renderPaginationButtons()}
            </div>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-lg transition-colors duration-200 ${
                currentPage === totalPages
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
      
      {/* Sidebars */}
      <CreateChargeSidebar
          isOpen={isCreateChargeSidebarOpen}
          onClose={() => setIsCreateChargeSidebarOpen(false)}
          onSuccess={fetchData}
      />
      <AssignChargeSidebar
          isOpen={isAssignChargeSidebarOpen}
          onClose={() => setIsAssignChargeSidebarOpen(false)}
          onSuccess={fetchData}
          charges={chargesData}
          customers={customers}
          initial={reassignInitial}
      />

      {/* Edit Charge Sidebar */}
      <Sidebar isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit charge">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Charge name</label>
            <input value={editState.chargeName} onChange={(e)=>setEditState({...editState, chargeName: e.target.value})} className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Type</label>
            <select value={editState.type} onChange={(e)=>setEditState({...editState, type: e.target.value})} className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
              <option value="Loan">Loan</option>
              <option value="Penalty">Penalty</option>
              <option value="Service">Service</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Amount</label>
            <input value={editState.amount} onChange={(e)=>setEditState({...editState, amount: e.target.value})} className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" />
          </div>
        </div>
        <div className="mt-8">
          <button
            onClick={async ()=>{
              try {
                await updateCharge({ id: editState.id, chargeName: editState.chargeName, type: editState.type, amount: editState.amount });
                Swal.fire({ icon:'success', title:'Charge updated'});
                setIsEditOpen(false);
                fetchData();
              } catch(err:any){
                Swal.fire({ icon:'error', title:'Failed', text: err?.message || 'Failed to update charge' });
              }
            }}
            className="w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-indigo-700 active:scale-[.98]"
          >
            Update charge
          </button>
        </div>
      </Sidebar>
    </div>
  );
};

export default App;
