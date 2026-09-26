"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Search, Pencil, Ellipsis, ArrowRight, ArrowLeft, ChevronUp, ChevronDown, X } from 'lucide-react';

const toInputDate = (display: string) => {
  const d = new Date(display);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

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
  onReassign: (row: HistoryItem) => void;
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

// Reusable Sidebar component — only mount when open so closed overlays never block page clicks
const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50">
            <div
                className="absolute inset-0 bg-black/30"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col">
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">{title}</h2>
                    <button type="button" onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors duration-200">
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
    const [assignToAll, setAssignToAll] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (isOpen) {
        setChargeName(initial?.chargeName || '');
        setAmount(initial?.amount || '');
        setDueDate(initial?.dueDate || '');
        setCustomer(initial?.customer || '');
        setAssignToAll(initial?.customer === 'all');
      }
    }, [isOpen, initial?.chargeName, initial?.amount, initial?.dueDate, initial?.customer]);

    const handleAssignAllToggle = (checked: boolean) => {
      setAssignToAll(checked);
      if (checked) {
        setCustomer('all');
      } else {
        setCustomer('');
      }
    };

    const handleAssign = async () => {
        const targetCustomer = assignToAll ? 'all' : customer;
        if (!chargeName || !amount || !dueDate || !targetCustomer) {
          Swal.fire({ icon: 'error', title: 'All fields are required', text: 'Please select a charge, due date, and customer(s).' });
          return;
        }
        setLoading(true);
        try {
          await assignCharge({ chargeName, amount, dueDate, customer: targetCustomer });
          Swal.fire({ 
            icon: 'success', 
            title: 'Charge Assigned', 
            text: assignToAll ? `Charge assigned to all ${customers.length} customers successfully.` : 'Charge assigned successfully.' 
          });
          onSuccess();
          onClose();
        } catch (err:any) {
          Swal.fire({ icon: 'error', title: 'Failed', text: err?.message || 'Failed to assign charge' });
        } finally {
          setLoading(false);
        }
    };

    return (
        <Sidebar isOpen={isOpen} onClose={onClose} title={initial?.customer ? 'Reassign charge' : 'Assign charges'}>
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
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="customer" className="block text-sm font-medium text-gray-700">Customer(s)</label>
                      <label className="inline-flex items-center gap-1.5 text-xs text-indigo-600 font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={assignToAll}
                          onChange={(e) => handleAssignAllToggle(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                        />
                        <span>Assign to ALL customers ({customers.length})</span>
                      </label>
                    </div>
                    {assignToAll ? (
                      <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-800 flex items-center justify-between">
                        <span>⚡ Charge will be assigned to <strong>all {customers.length} registered customers</strong></span>
                      </div>
                    ) : (
                      <select
                          id="customer"
                          name="customer"
                          value={customer}
                          onChange={(e) => {
                            if (e.target.value === 'all') {
                              handleAssignAllToggle(true);
                            } else {
                              setCustomer(e.target.value);
                            }
                          }}
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          style={{outline: 'none'}}
                      >
                          <option value="">Select customer</option>
                          <option value="all">⚡ ALL Customers ({customers.length} total)</option>
                          {customers.map((cust:any) => (
                            <option key={cust.id} value={cust.fullName}>{cust.fullName}</option>
                          ))}
                      </select>
                    )}
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
                    {loading ? 'Assigning...' : assignToAll ? `Assign to ALL (${customers.length} customers)` : 'Assign charges'}
                </button>
            </div>
        </Sidebar>
    );
};


// Import API functions
import { fetchCharges, fetchChargeHistory, createCharge, assignCharge, fetchCustomers, updateCharge, updateChargeAssignmentStatus } from '../../../../../services/api';
import Swal from 'sweetalert2';

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const isApplied = status === 'Applied' || status === 'Paid';
  const colorClass = isApplied ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {status}
    </span>
  );
};

const ChargesTable: React.FC<ChargesTableProps & { onEdit: (row: Charge) => void; onAssign: (row: Charge) => void }> = ({ data, sortConfig, onSort, rowsPerPage, searchTerm, onEdit, onAssign }) => {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const filteredData = data.filter(item =>
    Object.values(item).some(value =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  useEffect(() => {
    if (openMenuId === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: number) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 44;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight + 8 ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top, left: Math.max(8, rect.right - 160) });
    setOpenMenuId(openMenuId === id ? null : id);
  };

  return (
    <div className="rounded-lg border border-gray-200 overflow-x-auto overflow-y-visible">
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
                    <button type="button" onClick={() => onEdit(row)} className="p-2 rounded hover:bg-gray-100 transition-colors duration-200" aria-label="Edit">
                      <img src="/icons/lucide_edit.svg" alt="Edit" />
                    </button>
                    <button type="button" onClick={(e) => openMenu(e, row.id)} className="p-2 rounded hover:bg-gray-100 transition-colors duration-200" aria-label="More">
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

      {openMenuId !== null && (
        <div
          ref={menuRef}
          className="fixed z-[9999] w-40 rounded-md shadow-lg bg-white ring-1 ring-black/5 border border-gray-100"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {(() => {
            const row = filteredData.find((r) => r.id === openMenuId);
            if (!row) return null;
            return (
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  onAssign(row);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md"
              >
                Assign to customer
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
};

const ChargesHistoryTable: React.FC<ChargesHistoryTableProps> = ({ data, sortConfig, onSort, rowsPerPage, searchTerm, statusFilter, onMarkAsPaid, onReassign }) => {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const filteredData = data.filter(item => {
    const matchesSearch = Object.values(item).some(value =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    );
    const matchesStatus = statusFilter === 'All status' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    if (openMenuId === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: number) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 88;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight + 8
      ? rect.top - menuHeight - 4
      : rect.bottom + 4;
    setMenuPos({ top, left: Math.max(8, rect.right - 160) });
    setOpenMenuId(openMenuId === id ? null : id);
  };

  return (
    <div className="rounded-lg border border-gray-200 overflow-x-auto overflow-y-visible">
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
                  <button
                    type="button"
                    onClick={(e) => openMenu(e, row.id)}
                    className="inline-flex items-center justify-center p-2 rounded hover:bg-gray-100 transition-colors duration-200"
                  >
                    <img src="/icons/dots-bold.svg" alt="Options" />
                  </button>
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

      {openMenuId !== null && (
        <div
          ref={menuRef}
          className="fixed z-[9999] w-40 rounded-md shadow-lg bg-white ring-1 ring-black/5 border border-gray-100"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {(() => {
            const row = filteredData.find((r) => r.id === openMenuId);
            if (!row) return null;
            return (
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  onReassign(row);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md"
              >
                Reassign
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
};

const handleReassignRow = (
  row: HistoryItem,
  setReassignInitial: React.Dispatch<React.SetStateAction<{ chargeName?: string; amount?: string; dueDate?: string; customer?: string } | undefined>>,
  setIsAssignChargeSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
) => {
  setReassignInitial({
    chargeName: row.chargeName,
    amount: String(row.amount).replace(/[^\d.-]/g, ''),
    dueDate: toInputDate(row.dueDate),
    customer: row.customerName,
  });
  setIsAssignChargeSidebarOpen(true);
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

  const handleExport = (format: string) => {
    if (!format || format === 'Export') return;
    if (format === 'PDF') {
      window.print();
      return;
    }
    // CSV
    if (activeTab === 'Charges') {
      const headers = ['Charge Name', 'Type', 'Amount', 'Active Customers', 'Last Updated'];
      const rows = filteredData.map((item: any) => [
        `"${item.chargeName || ''}"`,
        `"${item.type || ''}"`,
        `"${item.amount || ''}"`,
        `"${item.activeCustomers || ''}"`,
        `"${item.lastUpdated || ''}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r: string[]) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'charges.csv'; a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ['Customer Name', 'Account Number', 'Charge Name', 'Amount', 'Due Date', 'Date Applied', 'Status'];
      const rows = filteredData.map((item: any) => [
        `"${item.customerName || ''}"`,
        `"${item.accountNumber || ''}"`,
        `"${item.chargeName || ''}"`,
        `"${item.amount || ''}"`,
        `"${item.dueDate || ''}"`,
        `"${item.dateApplied || ''}"`,
        `"${item.status || ''}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r: string[]) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'charges-history.csv'; a.click();
      URL.revokeObjectURL(url);
    }
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
              type="button"
              onClick={() => setIsCreateChargeSidebarOpen(true)}
              className="bg-white text-indigo-600 border border-gray-300 rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-gray-50 active:scale-[.98]"
            >
              <Plus size={18} />
              Create charges
            </button>
            <button
              type="button"
              onClick={() => { setReassignInitial(undefined); setIsAssignChargeSidebarOpen(true); }}
              className="bg-indigo-600 text-white rounded-lg px-4 py-2.5 shadow-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 hover:bg-indigo-700 active:scale-[.98]"
            >
              <Plus size={18} />
              Assign charges
            </button>
          </div>
        </div>

        {/* Tabs and Controls */}
        <div className="bg-white rounded-lg shadow-sm p-6 overflow-visible">
          <div className="flex items-center border-b border-gray-200 mb-6">
            <button
              type="button"
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
              type="button"
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
              {activeTab === 'Charges history' && (
                <button
                  type="button"
                  onClick={() => {
                    setReassignInitial(undefined);
                    setIsAssignChargeSidebarOpen(true);
                  }}
                  className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg px-4 py-2.5 shadow-sm font-medium text-sm transition-all duration-200 hover:bg-indigo-100 active:scale-[.98] w-full sm:w-auto"
                >
                  Reassign
                </button>
              )}
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
              <div className="relative w-full sm:w-auto">
                <select
                  defaultValue="Export"
                  onChange={(e) => { handleExport(e.target.value); e.target.value = 'Export'; }}
                  className="block w-full rounded-lg border border-gray-300 pl-4 pr-10 py-2.5 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 text-sm appearance-none cursor-pointer"
                >
                  <option value="Export">Export</option>
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                  <ChevronDown className="h-4 w-4" />
                </div>
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
              onAssign={(row) => {
                setReassignInitial({
                  chargeName: row.chargeName,
                  amount: String(row.amount).replace(/[^\d.-]/g, ''),
                  dueDate: new Date().toISOString().split('T')[0],
                  customer: '',
                });
                setIsAssignChargeSidebarOpen(true);
              }}
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
                    text: 'Mark this charge as paid? The amount will be deducted from the customer collection wallet.',
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
              onReassign={(row) => handleReassignRow(row, setReassignInitial, setIsAssignChargeSidebarOpen)}
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
