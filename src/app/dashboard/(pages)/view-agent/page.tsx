"use client";

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Filter, Search, MoreHorizontal, X } from 'lucide-react';
import '../../../../../global.css';
import { fetchAgentById } from '../../../../../services/api';

// Define interfaces for data structures
interface Customer {
  id: number;
  accountNumber: string;
  fullName: string;
  phoneNumber: string;
  package: string;
  dateCreated: string;
  status: 'Active' | 'Inactive';
}

interface Collection {
  id: number;
  customerName: string;
  amount: string;
  date: string;
  status: 'Paid' | 'Pending';
}

interface AgentData {
  fullName: string;
  phoneNumber: string;
  email: string;
  branch: string;
  password?: string;
  dateCreated: string;
  status: 'Active' | 'Inactive';
}

interface AgentProfileProps {
  isOpen: boolean;
  onClose: () => void;
  agentData: AgentData;
  onUpdateAgent: (updatedData: Partial<AgentData>) => void;
}

interface EditAgentSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: {
    fullName: string;
    phoneNumber: string;
    email: string;
    branch: string;
    password?: string;
  };
  onUpdateAgent: (updatedData: {
    fullName: string;
    phoneNumber: string;
    email: string;
    branch: string;
    password?: string;
  }) => void;
}

const EditAgentSidebar: React.FC<EditAgentSidebarProps> = ({ isOpen, onClose, initialData, onUpdateAgent }) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState(initialData);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onUpdateAgent(formData);
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-opacity-30 z-40 transition-opacity duration-300 ease-in-out"
          onClick={onClose}
        ></div>
      )}
      <aside
        ref={sidebarRef}
        className={`fixed top-0 right-0 h-full w-full max-w-full sm:max-w-md bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out z-50
          flex flex-col overflow-y-auto ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Edit agent</h2>
          <button onClick={onClose} className="p-2 text-gray-500 rounded-full hover:bg-gray-100 transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex-grow overflow-y-auto space-y-6">
          <div>
            <label htmlFor="branch" className="block text-sm font-semibold text-gray-700 mb-1">Branch</label>
            <div className="relative">
              <select
                id="branch"
                name="branch"
                value={formData.branch}
                onChange={handleChange}
                className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none cursor-pointer"
              >
                <option value="" disabled>Select branch</option>
                <option value="Tanko Branch">Tanko Branch</option>
                <option value="Iwo road branch">Iwo road branch</option>
                <option value="Lagos Island">Lagos Island</option>
                <option value="Abuja Central">Abuja Central</option>
                <option value="Port Harcourt">Port Harcourt</option>
                <option value="Kano North">Kano North</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="fullName" className="block text-sm font-semibold text-gray-700 mb-1">Full name</label>
            <input
              type="text"
              id="fullName"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="John doe"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="phoneNumber" className="block text-sm font-semibold text-gray-700 mb-1">Phone number</label>
            <input
              type="tel"
              id="phoneNumber"
              name="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleChange}
              placeholder="08045454645"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="johndoe@gmail.com"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
        </form>
        <div className="p-6 border-t border-gray-200">
          <button
            type="submit"
            onClick={handleSubmit}
            className="w-full py-4 px-6 bg-[#4e37fb] text-white font-semibold rounded-lg shadow-md hover:bg-[#4e37fb] transition-colors"
          >
            Update details
          </button>
        </div>
      </aside>
    </>
  );
};
// Helper component for displaying a single detail item
const DetailItem: React.FC<{ label: string; value: string; highlightColor?: string }> = ({ label, value, highlightColor }) => (
  <div>
    <p className="form-label">{label}</p>
    <p className={`font-medium text-black ${highlightColor}`}>{value}</p>
  </div>
);

const AgentProfile: React.FC<AgentProfileProps> = ({ isOpen, onClose, agentData, onUpdateAgent }) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isEditProfileSidebarOpen, setIsEditProfileSidebarOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Handle update from EditAgentSidebar
  const handleUpdate = (updatedData: any) => {
    onUpdateAgent(updatedData);
    setIsEditProfileSidebarOpen(false);
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-opacity-30 z-40 transition-opacity duration-300 ease-in-out"
          onClick={onClose}
        ></div>
      )}
      <aside
        ref={sidebarRef}
        className={`fixed top-0 right-0 h-full w-full max-w-full sm:max-w-md bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out z-50
          flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          <div className="flex justify-between items-center pb-6">
            <h2 className="text-xl font-bold text-gray-900">Agent details</h2>
            <button onClick={onClose} className="p-2 text-gray-500 rounded-full hover:bg-gray-100 transition-colors">
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="flex-grow space-y-4 text-sm text-gray-700">
            <DetailItem label="Branch" value={agentData.branch} />
            <DetailItem label="Full name" value={agentData.fullName} />
            <DetailItem label="Phone number" value={agentData.phoneNumber} />
            <DetailItem label="Email" value={agentData.email} />
            <DetailItem label="Password" value={agentData.password || "********"} />
            <DetailItem label="Date created" value={agentData.dateCreated} />
            <DetailItem label="Status" value={agentData.status} highlightColor={agentData.status === 'Active' ? 'text-green-600' : 'text-yellow-600'} />
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex space-x-4">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => setIsEditProfileSidebarOpen(true)}
            className="flex-1 py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Edit
          </button>
        </div>
        <EditAgentSidebar
          isOpen={isEditProfileSidebarOpen}
          onClose={() => setIsEditProfileSidebarOpen(false)}
          initialData={{
            fullName: agentData.fullName,
            phoneNumber: agentData.phoneNumber,
            email: agentData.email,
            branch: agentData.branch,
            password: agentData.password,
          }}
          onUpdateAgent={handleUpdate}
        />
      </aside>
    </>
  );
};
// AgentProfilePage Component (legacy fallback, kept but not used for routing)
const AgentProfilePage = () => {
  const [agentData, setAgentData] = useState({
    fullName: "",
    phoneNumber: "",
    email: "",
    branch: "",
    password: "",
    dateCreated: "",
    status: 'Active' as 'Active' | 'Inactive',
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const paramsRef = (typeof window !== 'undefined') ? window.location.pathname.split('/') : [] as any;
  const idFromPath = Array.isArray(paramsRef) ? paramsRef[paramsRef.length - 1] : undefined;
  const agentId = idFromPath && !isNaN(Number(idFromPath)) ? Number(idFromPath) : undefined;

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        if (!agentId) throw new Error('Invalid agent id');
        const data = await fetchAgentById(agentId);
        const agent = (data as any)?.agent || data;
        if (isMounted) {
          setAgentData({
            fullName: agent.fullName || '',
            phoneNumber: agent.phoneNumber || '',
            email: agent.email || '',
            branch: agent.branch || '',
            password: '',
            dateCreated: agent.createdAt ? new Date(agent.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ' - ' + new Date(agent.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
            status: (agent.status || 'Active') as 'Active' | 'Inactive',
          });
        }
      } catch (e:any) {
        if (isMounted) setError(e?.message || 'Failed to load agent');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => { isMounted = false };
  }, [agentId]);

  // Mock Wallet/Financial Data
  const walletData = {
    totalWallet: "N1,000,000",
    todayCollection: "N1,000,000",
    totalCustomer: "200",
    totalCollections: "N1,000,000",
    totalLoans: "N1,000,000",
    totalInvestments: "N1,000,000",
  };

  // Mock Customer Data
  const DUMMY_CUSTOMERS: Customer[] = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    accountNumber: `9345645${(100 + i).toString().slice(-2)}`,
    fullName: `James Odunayo ${i + 1}`,
    phoneNumber: '+234706564657',
    package: 'Alpha 1K',
    dateCreated: '23 Jan, 2025 - 10:00',
    status: i % 3 === 0 ? 'Inactive' : 'Active',
  }));

  // Mock Collections Data
  const DUMMY_COLLECTIONS: Collection[] = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    customerName: `Customer ${i + 1}`,
    amount: `N${(10000 + i * 500).toLocaleString()}`,
    date: '23 Jan, 2025',
    status: i % 2 === 0 ? 'Paid' : 'Pending',
  }));

  // State for tabs (Customers/Collections)
  const [activeTab, setActiveTab] = useState<'customers' | 'collections'>('customers');

  // State for table pagination and display
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedCustomers, setSelectedCustomers] = useState<number[]>([]); // For checkbox selection
  const [isProfileSidebarOpen, setIsProfileSidebarOpen] = useState(false);

  // New state for sorting
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'ascending' | 'descending' | null }>({
    key: '',
    direction: null,
  });

  // Handle sorting logic
  const handleSort = (key: string) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  // Memoized sorted data to avoid re-sorting on every render
  const sortedData = useMemo(() => {
    let sortableItems = [...(activeTab === 'customers' ? DUMMY_CUSTOMERS : DUMMY_COLLECTIONS)];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        // Handle sorting for both data types (Customer and Collection)
        const keyA = (a as any)[sortConfig.key];
        const keyB = (b as any)[sortConfig.key];

        if (keyA < keyB) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (keyA > keyB) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [activeTab, DUMMY_CUSTOMERS, DUMMY_COLLECTIONS, sortConfig]);

  // Update the agentData state when the EditAgentSidebar form is submitted
  const handleUpdateAgentData = (updatedData: Partial<AgentData>) => {
    setAgentData(prevData => ({ ...prevData, ...updatedData }));
  };

  // Now use the sortedData for pagination and display
  const totalPages = Math.ceil(sortedData.length / rowsPerPage);
  const indexOfLastItem = currentPage * rowsPerPage;
  const indexOfFirstItem = indexOfLastItem - rowsPerPage;
  const currentItems = sortedData.slice(indexOfFirstItem, indexOfLastItem);


  // Handlers for pagination
  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(Number(e.target.value));
    setCurrentPage(1); // Reset to first page when rows per page changes
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Render pagination buttons dynamically
  const renderPaginationButtons = () => {
    const pageButtons = [];
    const maxPageButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPageButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);

    if (endPage - startPage + 1 < maxPageButtons) {
      startPage = Math.max(1, endPage - maxPageButtons + 1);
    }

    if (startPage > 1) {
      pageButtons.push(<button key="1" onClick={() => handlePageChange(1)} className="w-10 h-10 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700">1</button>);
      if (startPage > 2) pageButtons.push(<span key="ellipsis-start" className="text-gray-500">...</span>);
    }

    for (let i = startPage; i <= endPage; i++) {
      pageButtons.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`w-10 h-10 rounded-md font-semibold transition-colors
            ${currentPage === i ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          {i}
        </button>
      );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pageButtons.push(<span key="ellipsis-end" className="text-gray-500">...</span>);
      pageButtons.push(<button key={totalPages} onClick={() => handlePageChange(totalPages)} className="w-10 h-10 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700">{totalPages}</button>);
    }

    return pageButtons;
  };

  // Handle checkbox selection for customers
  const handleCheckboxChange = (id: number) => {
    setSelectedCustomers(prevSelected =>
      prevSelected.includes(id)
        ? prevSelected.filter(item => item !== id)
        : [...prevSelected, id]
    );
  };

  const handleSelectAllChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedCustomers(currentItems.map(item => item.id));
    } else {
      setSelectedCustomers([]);
    }
  };

  const customersTableHeaders = [
    { label: "Account number", key: "accountNumber" },
    { label: "Full name", key: "fullName" },
    { label: "Phone number", key: "phoneNumber" },
    { label: "Package", key: "package" },
    { label: "Date created", key: "dateCreated" },
    { label: "Status", key: "status" },
    { label: "Action", key: "action" },
  ];

  const collectionsTableHeaders = [
    { label: "Customer Name", key: "customerName" },
    { label: "Amount", key: "amount" },
    { label: "Date", key: "date" },
    { label: "Status", key: "status" },
    { label: "Action", key: "action" },
  ];

  const headers = activeTab === 'customers' ? customersTableHeaders : collectionsTableHeaders;

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8 font-inter">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error}</div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">{loading ? 'Loading...' : agentData.fullName || 'Agent'}</h1>
        <div className="flex ml-auto space-x-3">
          <button type='button' onClick={() => setIsProfileSidebarOpen(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">
            View profile
          </button>
          <button className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg shadow-sm hover:bg-red-600 transition-colors">
            Deactivate account
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm mb-1">Total customer wallet</p>
          <p className="text-2xl font-bold text-gray-900">{walletData.totalWallet}</p>
        </div>
        <div className="bg-yellow-50 p-6 rounded-xl shadow-sm border border-yellow-200">
          <p className="text-gray-600 text-sm mb-1">Today's collection</p>
          <p className="text-2xl font-bold text-gray-900">{walletData.todayCollection}</p>
        </div>
        <div className="bg-red-50 p-6 rounded-xl shadow-sm border border-red-200">
          <p className="text-gray-600 text-sm mb-1">Total customer</p>
          <p className="text-2xl font-bold text-gray-900">{walletData.totalCustomer}</p>
        </div>
        <div className="bg-indigo-50 p-6 rounded-xl shadow-sm border border-indigo-200">
          <p className="text-gray-600 text-sm mb-1">Total collections</p>
          <p className="text-2xl font-bold text-gray-900">{walletData.totalCollections}</p>
        </div>
        <div className="bg-blue-50 p-6 rounded-xl shadow-sm border border-blue-200">
          <p className="text-gray-600 text-sm mb-1">Total loans</p>
          <p className="text-2xl font-bold text-gray-900">{walletData.totalLoans}</p>
        </div>
        <div className="bg-green-50 p-6 rounded-xl shadow-sm border border-green-200">
          <p className="text-gray-600 text-sm mb-1">Total Investments</p>
          <p className="text-2xl font-bold text-gray-900">{walletData.totalInvestments}</p>
        </div>
      </div>

      <div className="bg-white rounded-t-xl shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('customers')}
            className={`py-4 px-6 text-center text-lg font-medium transition-colors ${
              activeTab === 'customers'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Customers
          </button>
          <button
            onClick={() => setActiveTab('collections')}
            className={`py-4 px-6 text-center text-lg font-medium transition-colors ${
              activeTab === 'collections'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Collections
          </button>
        </div>

        <div className="p-4 sm:p-6 bg-white">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
              <button className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-gray-900 hover:bg-gray-100 w-full sm:w-auto">
                <img src="/icons/filter.png" alt="" />
                <span>Filter</span>
              </button>
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
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 pt-4 text-gray-700">
                  <ChevronDown className="h-5 w-5" />
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
              {activeTab === 'customers' && (
                <button className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg shadow-md hover:bg-indigo-700 transition-colors w-full sm:w-auto">
                  Reassign
                </button>
              )}
              <div className="relative w-full sm:w-64">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pt-4 pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search"
                  className="block w-full rounded-lg border border-gray-300 pl-10 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {activeTab === 'customers' && (
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                        onChange={handleSelectAllChange}
                        checked={selectedCustomers.length === currentItems.length && currentItems.length > 0}
                      />
                    </th>
                  )}
                  {headers.map(({ label, key }) => (
                    // Make each header a clickable button for sorting
                    <th key={key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button
                        onClick={() => handleSort(key)}
                        className="flex items-center gap-1 font-medium text-gray-500 hover:text-gray-900"
                      >
                        {label}
                        {/* Conditionally render the up/down arrows */}
                        {/* {sortConfig.key === key && (
                          sortConfig.direction === 'ascending' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        )} */}
                        {/* Show both arrows if not currently sorted */}
                        {/* {sortConfig.key !== key && (
                          <div className="flex flex-col text-gray-300">
                            <ChevronUp className="h-4 w-4 mb-[-4px]" />
                            <ChevronDown className="h-4 w-4" />
                          </div>
                        )} */}
                      </button>
                    </th>
                  ))}
                  {/* The Action column is not sortable, so it's handled separately */}
                  {/* <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th> */}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {currentItems.length > 0 ? (
                  currentItems.map((item: Customer | Collection) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      {activeTab === 'customers' && (
                        <td className="px-4 py-4 whitespace-nowrap">
                          <input
                            type="checkbox"
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                            checked={selectedCustomers.includes(item.id)}
                            onChange={() => handleCheckboxChange(item.id)}
                          />
                        </td>
                      )}
                      {activeTab === 'customers' ? (
                        <>
                          <td className="px-4 py-4 text-sm text-gray-900 font-medium">{(item as Customer).accountNumber}</td>
                          <td className="px-4 py-4 text-sm text-gray-900">{(item as Customer).fullName}</td>
                          <td className="px-4 py-4 text-sm text-gray-900">{(item as Customer).phoneNumber}</td>
                          <td className="px-4 py-4 text-sm text-gray-900">{(item as Customer).package}</td>
                          <td className="px-4 py-4 text-sm text-gray-900">{(item as Customer).dateCreated}</td>
                          <td className="px-4 py-4 text-sm">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              (item as Customer).status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {(item as Customer).status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-right flex items-center justify-end space-x-2">
                            <button className="px-4 py-2 rounded-lg text-indigo-600 border border-indigo-600 hover:bg-indigo-50 transition-colors text-sm font-medium">
                              View
                            </button>
                            <button className="text-gray-500 hover:text-indigo-600 transition-colors p-1 rounded-full">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-4 text-sm text-gray-900 font-medium">{(item as Collection).customerName}</td>
                          <td className="px-4 py-4 text-sm text-gray-900">{(item as Collection).amount}</td>
                          <td className="px-4 py-4 text-sm text-gray-900">{(item as Collection).date}</td>
                          <td className="px-4 py-4 text-sm">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              (item as Collection).status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {(item as Collection).status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-right flex items-center justify-end space-x-2">
                            <button className="px-4 py-2 rounded-lg text-indigo-600 border border-indigo-600 hover:bg-indigo-50 transition-colors text-sm font-medium">
                              View
                            </button>
                            <button className="text-gray-500 hover:text-indigo-600 transition-colors p-1 rounded-full">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={activeTab === 'customers' ? 8 : 5} className="text-center py-8 text-gray-500">No data available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 flex flex-col sm:flex-row items-center gap-4 justify-between">
            <button
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-100 text-sm text-gray-700 w-full sm:w-auto"
            >
              Previous
            </button>
            <div className="flex flex-wrap justify-center gap-2">{renderPaginationButtons()}</div>
            <button
              disabled={currentPage === totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              className="py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-100 text-sm text-gray-700 w-full sm:w-auto"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      <AgentProfile
        isOpen={isProfileSidebarOpen}
        onClose={() => setIsProfileSidebarOpen(false)}
        agentData={agentData}
        onUpdateAgent={handleUpdateAgentData}
      />
    </div>
  );
};

export default AgentProfilePage;