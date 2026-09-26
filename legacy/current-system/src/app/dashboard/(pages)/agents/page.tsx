"use client";
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, ChevronDown, ChevronUp, Search, Filter, MoreHorizontal, Edit, PowerOff, X } from 'lucide-react';
import LoadingButton from '../../../../../components/LoadingButton';
import { useRouter } from 'next/navigation';
import { fetchAgents, updateAgentStatus, addAgent, updateAgent, fetchCustomers, getBranches } from '../../../../../services/api';

// Define the Agent interface
interface Agent {
  id: number;
  fullName: string;
  email: string;
  phoneNumber: string;
  password?: string;
  branch: string;
  customers: number;
  dateCreated: string;
  status: 'Active' | 'Inactive';
}

// Props interface for the sidebar components
interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// Add Agent Sidebar Component
interface AddAgentSidebarProps extends SidebarProps {
  onAddAgent: (newAgent: { fullName: string; phoneNumber: string; email: string; password: string; branch: string; merchantId: number; }) => void;
}

const AddAgentSidebar: React.FC<AddAgentSidebarProps> = ({ isOpen, onClose, onAddAgent }) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    fullName: '',
    phoneNumber: '',
    email: '',
    password: '',
    branch: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [branches, setBranches] = useState<Array<{id: number; name: string}>>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Effect to handle clicks outside the sidebar to close it
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

  // Effect to fetch branches when sidebar opens
  useEffect(() => {
    const fetchBranches = async () => {
      if (isOpen && branches.length === 0) {
        try {
          setLoadingBranches(true);
          const response = await getBranches();
          setBranches(response.branches || []);
        } catch (error) {
          console.error('Error fetching branches:', error);
          setFormError('Failed to load branches');
        } finally {
          setLoadingBranches(false);
        }
      }
    };

    fetchBranches();
  }, [isOpen, branches.length]);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (formError) setFormError(''); // Clear error on input change
  };

  // Handle form submission
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Basic validation
    if (!formData.fullName || !formData.phoneNumber || !formData.email || !formData.password || !formData.branch) {
      setFormError("Full Name, Phone Number, Email, Password, and Branch are required.");
      return;
    }

    try {
      setSubmitting(true);
      await onAddAgent(formData as any);
      setFormData({
        fullName: '',
        phoneNumber: '',
        email: '',
        password: '',
        branch: '',
      });
      setFormError('');
      onClose();
    } catch (e: any) {
      const message = e?.message || 'Failed to add agent';
      setFormError(message);
      if (typeof window !== 'undefined') alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-opacity-30 z-40 transition-opacity duration-300 ease-in-out"
          onClick={onClose}
        ></div>
      )}
      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`fixed top-0 right-0 h-full w-full max-w-full sm:max-w-md bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out z-50
          flex flex-col overflow-y-auto ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Add agent</h2>
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
                disabled={loadingBranches}
                className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none cursor-pointer disabled:bg-gray-100"
              >
                <option value="" disabled>
                  {loadingBranches ? 'Loading branches...' : 'Select branch'}
                </option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
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
          {formError && <p className="text-red-500 text-sm">{formError}</p>}
          <div className="mt-8">
            <LoadingButton
              type="submit"
              loading={submitting}
              loadingText="Adding..."
              className="w-full py-4 px-6 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700"
            >
              Add agent
            </LoadingButton>
          </div>
        </form>
      </aside>
    </>
  );
};

// Edit Agent Sidebar Component
interface EditAgentSidebarProps extends SidebarProps {
  agentToEdit: Agent | null;
  onUpdateAgent: (updatedAgent: Agent) => void;
}

const EditAgentSidebar: React.FC<EditAgentSidebarProps> = ({ isOpen, onClose, agentToEdit, onUpdateAgent }) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [editedAgentData, setEditedAgentData] = useState<Agent | any>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [branches, setBranches] = useState<Array<{id: number; name: string}>>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Populate form data when agentToEdit changes
  useEffect(() => {
    if (agentToEdit) {
      setEditedAgentData({ ...agentToEdit });
    }
  }, [agentToEdit]);

  // Effect to handle clicks outside the sidebar to close it
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

  // Effect to fetch branches when sidebar opens
  useEffect(() => {
    const fetchBranches = async () => {
      if (isOpen && branches.length === 0) {
        try {
          setLoadingBranches(true);
          const response = await getBranches();
          setBranches(response.branches || []);
        } catch (error) {
          console.error('Error fetching branches:', error);
          setFormError('Failed to load branches');
        } finally {
          setLoadingBranches(false);
        }
      }
    };

    fetchBranches();
  }, [isOpen, branches.length]);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditedAgentData((prev:any) => prev ? { ...prev, [name]: value } : null);
    if (formError) setFormError(''); // Clear error on input change
  };

  // Handle form submission
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!editedAgentData) {
      setFormError("No agent data to update.");
      return;
    }

    // Basic validation
    if (!editedAgentData.fullName || !editedAgentData.phoneNumber || !editedAgentData.email || !editedAgentData.branch) {
      setFormError("Full Name, Phone Number, Email, and Branch are required.");
      return;
    }

    try {
      setSubmitting(true);
      await onUpdateAgent(editedAgentData);
      setFormError('');
      onClose();
    } catch (e: any) {
      const message = e?.message || 'Failed to update agent';
      setFormError(message);
      if (typeof window !== 'undefined') alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!editedAgentData && isOpen) return null; // Don't render if no agent data and sidebar is supposed to be open

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-opacity-30 z-40 transition-opacity duration-300 ease-in-out"
          onClick={onClose}
        ></div>
      )}
      {/* Sidebar */}
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
                value={editedAgentData?.branch || ''}
                onChange={handleChange}
                disabled={loadingBranches}
                className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none cursor-pointer disabled:bg-gray-100"
              >
                <option value="" disabled>
                  {loadingBranches ? 'Loading branches...' : 'Select branch'}
                </option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
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
              value={editedAgentData?.fullName || ''}
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
              value={editedAgentData?.phoneNumber || ''}
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
              value={editedAgentData?.email || ''}
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
              value={editedAgentData?.password || ''} // Consider if you want to pre-fill password or leave empty for security
              onChange={handleChange}
              placeholder="••••••••"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          {formError && <p className="text-red-500 text-sm">{formError}</p>}
          <div className="mt-8">
            <LoadingButton
              type="submit"
              loading={submitting}
              loadingText="Updating..."
              className="w-full py-4 px-6 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700"
            >
              Update details
            </LoadingButton>
          </div>
        </form>
      </aside>
    </>
  );
};


// Main Page Component
export default function Page() {
  const [agents, setAgents] = useState<Agent[]>([]);

  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isAddAgentSidebarOpen, setIsAddAgentSidebarOpen] = useState(false); // State for Add Agent Sidebar
  const [isEditAgentSidebarOpen, setIsEditAgentSidebarOpen] = useState(false); // State for Edit Agent Sidebar
  const [agentToEdit, setAgentToEdit] = useState<Agent | null>(null); // Agent data to pass to Edit sidebar

  const [sortConfig, setSortConfig] = useState<{ key: keyof Agent | any; direction: 'ascending' | 'descending' }>({
    key: null,
    direction: 'ascending',
  });

  // State for dynamic data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const sortedAgents = useMemo(() => {
    let filteredAgents = [...agents];
    
    // Apply search filter
    if (searchTerm) {
      filteredAgents = filteredAgents.filter(agent =>
        agent.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        agent.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        agent.phoneNumber.includes(searchTerm) ||
        agent.branch.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply sorting
    if (sortConfig.key !== null) {
      filteredAgents.sort((a:any, b:any) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'ascending'
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return filteredAgents;
  }, [agents, sortConfig, searchTerm]);

  const requestSort = (key: keyof Agent) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const getSortIcon = (key: keyof Agent) => {
    const isSorted = sortConfig.key === key;
    const isAsc = sortConfig.direction === 'ascending';
  
    return (
      <span className="flex flex-col items-center ml-1">
        <ChevronUp 
          className={`h-4 w-4 ${isSorted && isAsc ? 'text-gray-900' : 'text-gray-400'}`}
        />
        <ChevronDown 
          className={`h-4 w-4 -mt-2 ${isSorted && !isAsc ? 'text-gray-900' : 'text-gray-400'}`}
        />
      </span>
    );
  };


  const totalPages = Math.ceil(sortedAgents.length / rowsPerPage);
  const indexOfLastItem = currentPage * rowsPerPage;
  const indexOfFirstItem = indexOfLastItem - rowsPerPage;
  const currentAgents = sortedAgents.slice(indexOfFirstItem, indexOfLastItem);
  const router = useRouter();
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null); // For the MoreHorizontal dropdown

  // Pagination Handlers
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

  // Dropdown for MoreHorizontal icon
  const toggleDropdown = (id: number) => {
    setOpenDropdownId(openDropdownId === id ? null : id);
  };

  // Function to open the Edit Agent Sidebar
  const openEditAgentSidebar = (agent: Agent) => {
    setAgentToEdit(agent);
    setIsEditAgentSidebarOpen(true);
    setOpenDropdownId(null); // Close the MoreHorizontal dropdown
  };

  // Function to handle deactivating an agent
  const handleDeactivate = async (agentId: number) => {
    try {
      const response = await updateAgentStatus(agentId, 'Inactive');
      if (response.success) {
        setAgents(prevAgents =>
          prevAgents.map(agent =>
            agent.id === agentId ? { ...agent, status: 'Inactive' } : agent
          )
        );
        setOpenDropdownId(null); // Close dropdown after action
      }
    } catch (error) {
      console.error('Error deactivating agent:', error);
      setError('Failed to deactivate agent. Please try again.');
    }
  };

  // Function to add a new agent
  const handleAddAgent = async (newAgentData: { fullName: string; phoneNumber: string; email: string; password: string; branch: string; merchantId: number; }) => {
    try {
      const response = await addAgent(newAgentData);
      if (response.success) {
        // Refresh the agents list
        await fetchData();
      }
    } catch (error) {
      console.error('Error adding agent:', error);
      const message = (error as any)?.message || 'Failed to add agent';
      setError(message);
      if (typeof window !== 'undefined') {
        alert(message);
      }
    }
  };

  // Function to update an existing agent
  const handleUpdateAgent = async (updatedAgent: Agent) => {
    try {
      const agentData = {
        id: updatedAgent.id,
        fullName: updatedAgent.fullName,
        phoneNumber: updatedAgent.phoneNumber,
        email: updatedAgent.email,
        password: updatedAgent.password || '',
        branch: updatedAgent.branch,
        status: updatedAgent.status,
      };
      const response = await updateAgent(agentData);
      if (response.success) {
        // Refresh the agents list
        await fetchData();
      }
    } catch (error) {
      console.error('Error updating agent:', error);
      const message = (error as any)?.message || 'Failed to update agent';
      setError(message);
      if (typeof window !== 'undefined') {
        alert(message);
      }
    }
  };
  const viewAgent = (agent_id:any)=>{
    router.push(`/dashboard/view-agent/${agent_id}`);
  }

  const handleExport = (format: string) => {
    if (!format || format === 'Export') return;
    if (format === 'PDF') {
      window.print();
      return;
    }
    // CSV export
    const headers = ['Full Name', 'Phone Number', 'Branch', 'Customers', 'Date Created', 'Status'];
    const rows = sortedAgents.map(a => [
      `"${a.fullName}"`,
      `"${a.phoneNumber}"`,
      `"${a.branch}"`,
      `"${a.customers}"`,
      `"${a.dateCreated}"`,
      `"${a.status}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agents.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch data function
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [agentsRes, customersRes] = await Promise.all([
        fetchAgents().catch(() => ({ success: false, agents: [] })),
        fetchCustomers().catch(() => ({ success: false, customers: [] })),
      ]);

      const customersList: any[] = Array.isArray((customersRes as any)?.customers)
        ? (customersRes as any).customers
        : Array.isArray(customersRes) ? (customersRes as any) : [];

      if ((agentsRes as any).success) {
        const formattedAgents = (agentsRes as any).agents.map((agent: any) => {
          const customersCount = typeof agent.customersCount === 'number'
            ? agent.customersCount
            : customersList.filter((c: any) => {
                const aId = c.agentId || c.agent?.id;
                return aId === agent.id || String(aId) === String(agent.id);
              }).length;
          return {
            id: agent.id,
            fullName: agent.fullName,
            phoneNumber: agent.phoneNumber,
            email: agent.email,
            branch: agent.branch,
            customers: customersCount,
            dateCreated:
              new Date(agent.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              }) +
              ' - ' +
              new Date(agent.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }),
            status: agent.status || 'Active',
          } as Agent;
        });
        setAgents(formattedAgents);
      }
    } catch (error) {
      console.error('Error fetching agents:', error);
      setError('Failed to load agents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    fetchData();
  }, []);

  // Effect to handle clicks outside of the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownRef]);


  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
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

      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">Agents</h1>
          <p className="text-gray-600 text-sm sm:text-base">
            Manage your agents. View profiles, track performance, and control access to agent accounts.
          </p>
        </div>
        <div className='ml-auto flex gap-2'>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center space-x-2 bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-gray-700 transition-colors w-full sm:w-auto max-w-xs mx-auto md:mx-0 mt-4 md:mt-0"
          >
            <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <button
            onClick={() => setIsAddAgentSidebarOpen(true)} // Open Add Agent Sidebar
            aria-label="Add agent"
            className="flex items-center space-x-2 bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-indigo-700 transition-colors w-full sm:w-auto max-w-xs mx-auto md:mx-0 mt-4 md:mt-0"
          >
            <Plus className="h-5 w-5" />
            <span className="hidden sm:inline">Add agent</span>
          </button>
        </div>
      </div>

      {/* Filter/Search */}
      <div className="bg-white p-4 sm:p-6 shadow-sm mb-6 rounded-xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
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
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <div className="relative w-full sm:w-auto">
              <select
                className="block w-full appearance-none rounded-lg border border-gray-300 pl-4 pr-10 py-3 text-gray-900 sm:text-sm"
                defaultValue="Export"
                onChange={(e) => { handleExport(e.target.value); e.target.value = 'Export'; }}
              >
                <option value="Export">Export</option>
                <option value="PDF">PDF</option>
                <option value="CSV">CSV</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
            <div className="relative w-full sm:w-64">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search agents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 pl-10 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white shadow-sm overflow-x-auto rounded-xl">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => requestSort('fullName')}
              >
                <div className="flex items-center">
                  Full name
                  {getSortIcon('fullName')}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell cursor-pointer"
                onClick={() => requestSort('phoneNumber')}
              >
                <div className="flex items-center">
                  Phone number
                  {getSortIcon('phoneNumber')}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell cursor-pointer"
                onClick={() => requestSort('branch')}
              >
                <div className="flex items-center">
                  Branch
                  {getSortIcon('branch')}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell cursor-pointer"
                onClick={() => requestSort('customers')}
              >
                <div className="flex items-center">
                  Customers
                  {getSortIcon('customers')}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell cursor-pointer"
                onClick={() => requestSort('dateCreated')}
              >
                <div className="flex items-center">
                  Date created
                  {getSortIcon('dateCreated')}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => requestSort('status')}
              >
                <div className="flex items-center">
                  Status
                  {getSortIcon('status')}
                </div>
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center">
                  <div className="flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 text-indigo-500 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading agents...
                  </div>
                </td>
              </tr>
            ) : currentAgents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-gray-500">
                  {searchTerm ? 'No agents found matching your search' : 'No agents found'}
                </td>
              </tr>
            ) : (
              currentAgents.map(agent => (
              <tr key={agent.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-4 text-sm text-gray-900 font-medium truncate max-w-xs">{agent.fullName}</td>
                <td className="px-4 py-4 text-sm text-gray-900 hidden md:table-cell">{agent.phoneNumber}</td>
                <td className="px-4 py-4 text-sm text-gray-900 hidden md:table-cell">{agent.branch}</td>
                <td className="px-4 py-4 text-sm text-gray-900 hidden md:table-cell">{agent.customers}</td>
                <td className="px-4 py-4 text-sm text-gray-900 hidden md:table-cell">{agent.dateCreated}</td>
                <td className="px-4 py-4 text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${agent.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {agent.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm flex text-right relative">
                  <button onClick={()=>viewAgent(agent.id)} className="px-4 py-2 rounded-lg text-indigo-600 border border-indigo-600 hover:bg-indigo-50 transition-colors text-sm font-medium">
                    View
                  </button>
                  
                  <button
                    onClick={() => toggleDropdown(agent.id)}
                    className="text-gray-500 hover:text-indigo-600 transition-colors p-2 rounded-full focus:outline-none"
                    aria-haspopup="true"
                    aria-expanded={openDropdownId === agent.id}
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>

                  {/* Dropdown Menu */}
                  {openDropdownId === agent.id && (
                    <div ref={dropdownRef} className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10 focus:outline-none">
                      <button
                        onClick={() => openEditAgentSidebar(agent)} // Open Edit Agent Sidebar
                        className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                        role="menuitem"
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit agent
                      </button>
                      <button
                        onClick={() => handleDeactivate(agent.id)}
                        className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                        role="menuitem"
                      >
                        <PowerOff className="mr-2 h-4 w-4" />
                        Deactivate
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
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

      {/* Add Agent Sidebar */}
      <AddAgentSidebar isOpen={isAddAgentSidebarOpen} onClose={() => setIsAddAgentSidebarOpen(false)} onAddAgent={handleAddAgent} />

      {/* Edit Agent Sidebar */}
      <EditAgentSidebar isOpen={isEditAgentSidebarOpen} onClose={() => setIsEditAgentSidebarOpen(false)} agentToEdit={agentToEdit} onUpdateAgent={handleUpdateAgent} />
    </div>
  );
}
