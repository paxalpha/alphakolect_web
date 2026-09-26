"use client"
import Image from "next/image";
import { useRouter } from "next/navigation";
import '../../../../../global.css';
import React, { useState, useRef, useEffect } from 'react';
import Swal from "sweetalert2";
import { createBranch, updateBranch, fetchBranches, deleteBranch, fetchAgents, fetchCustomers } from "@/services/api";
import Link from "next/link";
import { Plus, Search, Edit, X, ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from 'lucide-react';
import { LuChevronDown, LuX } from "react-icons/lu";

// Define a TypeScript interface for a Branch object
interface Branch {
  id: number;
  name: string;
  state: string;
  location: string;
  agents: number;
  customers: number;
}

// Define the props for the new sidebar component
interface CreateBranchSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BranchManagement() {
    // ...existing code...

    const [searchTerm, setSearchTerm] = useState('');
    const [stateFilter, setStateFilter] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    React.useEffect(() => {
      const loadBranches = async () => {
        try {
          const [branchesData, agentsData, customersData] = await Promise.all([
            fetchBranches().catch(() => ({ branches: [] })),
            fetchAgents().catch(() => ({ agents: [] })),
            fetchCustomers().catch(() => ({ customers: [] })),
          ]);

          const branchesList: any[] = branchesData?.branches || [];
          const agentsList: any[] = (agentsData as any)?.agents || [];
          const customersList: any[] = (customersData as any)?.customers || [];

          const branchesWithCounts = branchesList.map((b: any) => {
            const branchId = b.id ?? b._id;
            const agentsCount = agentsList.filter((a: any) => a.branchId === branchId || a.branch === b.name).length;
            const customersCount = customersList.filter((c: any) => c.branchId === branchId || c.branch?.name === b.name || c.branchName === b.name).length;
            return {
              id: b.id,
              name: b.name,
              state: b.state,
              location: b.location,
              agents: b.agents ?? agentsCount,
              customers: b.customers ?? customersCount,
            } as Branch;
          });
          setBranches(branchesWithCounts);
        } catch (error) {
          console.error('Failed to fetch branches:', error);
          // Swal.fire({
          //   icon: 'error',
          //   title: 'Error',
          //   text: 'Failed to load branches',
          // });
        }
      };
      loadBranches();
    }, []);

    // Delete branch handler
    const handleDelete = async (branchId: number) => {
      const confirmResult = await Swal.fire({
        title: 'Are you sure?',
        text: 'This action will delete the branch permanently.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel',
      });
      if (confirmResult.isConfirmed) {
        try {
          await deleteBranch(branchId);
          setBranches(prev => prev.filter(b => b.id !== branchId));
          Swal.fire({
            icon: 'success',
            title: 'Deleted!',
            text: 'Branch has been deleted.',
            timer: 2000,
            showConfirmButton: false,
          });
        } catch (error: any) {
          Swal.fire({
            icon: 'error',
            title: 'Failed to delete branch',
            text: error?.message || 'An error occurred while deleting the branch.',
          });
        }
      }
    };

    // Edit Branch Modal
    const EditBranchModal = () => {
      if (!isEditModalOpen || !branchToEdit) return null;
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-8 relative">
            <button onClick={() => setIsEditModalOpen(false)} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
              <X className="h-6 w-6" />
            </button>
            <h2 className="text-2xl font-bold mb-6">Edit Branch</h2>
            <form onSubmit={handleEditSubmit} className="space-y-6">
              <div>
                <label htmlFor="edit-branch-name" className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  id="edit-branch-name"
                  name="name"
                  value={branchToEdit.name}
                  onChange={handleEditChange}
                  className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="edit-state" className="block text-sm font-semibold text-gray-700 mb-1">State</label>
                <select
                  id="edit-state"
                  name="state"
                  value={branchToEdit.state}
                  onChange={handleEditChange}
                  className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
                >
                  <option value="Oyo">Oyo</option>
                  <option value="Kwara">Kwara</option>
                  <option value="Lagos">Lagos</option>
                  {/* Add more states here */}
                </select>
              </div>
              <div>
                <label htmlFor="edit-location" className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  id="edit-location"
                  name="location"
                  value={branchToEdit.location}
                  onChange={handleEditChange}
                  className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isUpdating}
                  className={`px-6 py-3 bg-indigo-600 text-white font-semibold rounded-md transition-colors ${
                    isUpdating
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-indigo-700'
                  }`}
                >
                  {isUpdating ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Updating...
                    </div>
                  ) : (
                    'Update Branch'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    };
    // Handles sorting when a column header is clicked
    const requestSort = (key: keyof Branch) => {
      setSortConfig(prev => {
        if (prev.key === key) {
          // Toggle direction
          return {
            key,
            direction: prev.direction === 'ascending' ? 'descending' : 'ascending',
          };
        } else {
          // New sort key
          return {
            key,
            direction: 'ascending',
          };
        }
      });
    };
    const router = useRouter();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [rowsPerPage, setRowsPerPage] = useState<number>(10);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: keyof Branch | null; direction: 'ascending' | 'descending' | null }>({ key: null, direction: null });
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [branchToEdit, setBranchToEdit] = useState<Branch | null>(null);

    // Filtering and searching logic
    const filteredBranches = React.useMemo(() => {
      let filtered = [...branches];

      // Apply search filter
      if (searchTerm) {
        filtered = filtered.filter(branch =>
          branch.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          branch.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
          branch.state.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }

      // Apply state filter
      if (stateFilter) {
        filtered = filtered.filter(branch => branch.state === stateFilter);
      }

      return filtered;
    }, [branches, searchTerm, stateFilter]);

    // Sorting logic
    const sortedBranches = React.useMemo(() => {
      let sortableItems = [...filteredBranches];
      if (sortConfig.key !== null) {
        sortableItems.sort((a, b) => {
          const aValue = a[sortConfig.key as keyof Branch];
          const bValue = b[sortConfig.key as keyof Branch];
          if (typeof aValue === 'string' && typeof bValue === 'string') {
            if (aValue.toLowerCase() < bValue.toLowerCase()) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (aValue.toLowerCase() > bValue.toLowerCase()) return sortConfig.direction === 'ascending' ? 1 : -1;
          } else {
            if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
          }
          return 0;
        });
      }
      return sortableItems;
    }, [filteredBranches, sortConfig]);

    // Reset to page 1 when filters change
    React.useEffect(() => {
      setCurrentPage(1);
    }, [searchTerm, stateFilter]);

    // Pagination logic
    const totalPages = Math.ceil(sortedBranches.length / rowsPerPage);
    const indexOfLastItem = currentPage * rowsPerPage;
    const indexOfFirstItem = indexOfLastItem - rowsPerPage;
    const currentBranches = sortedBranches.slice(indexOfFirstItem, indexOfLastItem);

    // Edit modal logic
    const handleEdit = (branchId: number) => {
      const branch = branches.find(b => b.id === branchId) || null;
      setBranchToEdit(branch);
      setIsEditModalOpen(true);
    };

    const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (!branchToEdit) return;
      const { name, value } = e.target;
      setBranchToEdit(prev => prev ? { ...prev, [name]: value } : null);
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!branchToEdit || !branchToEdit.name || !branchToEdit.state || !branchToEdit.location) {
        Swal.fire({
          icon: "warning",
          title: "All fields are required",
          text: "Please fill in all fields."
        });
        return;
      }
      setIsUpdating(true);
      try {
        const result = await updateBranch(branchToEdit);
        Swal.fire({
          icon: "success",
          title: "Branch Updated",
          text: result.message || "Branch has been updated successfully.",
          showConfirmButton: false,
          timer: 2000
        });
        setBranches(prev => prev.map(b => b.id === branchToEdit.id ? { ...branchToEdit } : b));
        setIsEditModalOpen(false);
        setBranchToEdit(null);
      } catch (error: any) {
        Swal.fire({
          icon: "error",
          title: "Failed to Update Branch",
          text: error?.message || "An error occurred while updating the branch."
        });
      } finally {
        setIsUpdating(false);
      }
    };
// --- CreateBranchSidebar as a separate component ---
const CreateBranchSidebar: React.FC<CreateBranchSidebarProps> = ({ isOpen, onClose }) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({ name: '', state: 'Oyo', location: '' });
  const [formError, setFormError] = useState('');

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
    if (formError) setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.name || !formData.state || !formData.location) {
      setFormError('All fields are required.');
      return;
    }
    setIsCreating(true);
    try {
      const result = await createBranch(formData);
      Swal.fire({
        icon: "success",
        title: "Branch Created",
        text: result.message || "Branch has been created successfully.",
        showConfirmButton: false,
        timer: 2000
      });
      // Add new branch to state
      if (result.branch) {
        setBranches(prev => [...prev, {
          id: result.branch.id,
          name: result.branch.name,
          state: result.branch.state,
          location: result.branch.location,
          agents: 0,
          customers: 0,
        }]);
      }
      setFormData({ name: '', state: 'Oyo', location: '' });
      setFormError('');
      onClose();
    } catch (error: any) {
      Swal.fire({
        icon: "error",
        title: "Failed to Create Branch",
        text: error?.message || "An error occurred while creating the branch."
      });
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300 ease-in-out"
        onClick={onClose}
      ></div>
      {/* Sidebar container */}
      <aside 
        ref={sidebarRef}
        className={`
          fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-xl 
          transform transition-transform duration-300 ease-in-out z-50
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col
        `}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Create branch</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 rounded-full hover:bg-gray-100 transition-colors"
          >
            <LuX className="h-6 w-6" />
          </button>
        </div>
        {/* Form content */}
        <form onSubmit={handleSubmit} className="p-6 flex-grow overflow-y-auto space-y-6">
          {/* Name input */}
          <div>
            <label htmlFor="branch-name" className="block text-sm font-semibold text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              id="branch-name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter name"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>
          {/* State dropdown */}
          <div>
            <label htmlFor="state" className="block text-sm font-semibold text-gray-700 mb-1">
              State
            </label>
            <div className="relative">
              <select
                id="state"
                name="state"
                value={formData.state}
                onChange={handleChange}
                className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 pt-5 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
              >
                <option value="abia">Abia</option>
                <option value="adamawa">Adamawa</option>
                <option value="akwa-ibom">Akwa Ibom</option>
                <option value="anambra">Anambra</option>
                <option value="bauchi">Bauchi</option>
                <option value="bayelsa">Bayelsa</option>
                <option value="benue">Benue</option>
                <option value="borno">Borno</option>
                <option value="cross-river">Cross River</option>
                <option value="delta">Delta</option>
                <option value="ebonyi">Ebonyi</option>
                <option value="edo">Edo</option>
                <option value="ekiti">Ekiti</option>
                <option value="enugu">Enugu</option>
                <option value="fct">Federal Capital Territory (FCT)</option>
                <option value="gombe">Gombe</option>
                <option value="imo">Imo</option>
                <option value="jigawa">Jigawa</option>
                <option value="kaduna">Kaduna</option>
                <option value="kano">Kano</option>
                <option value="katsina">Katsina</option>
                <option value="kebbi">Kebbi</option>
                <option value="kogi">Kogi</option>
                <option value="kwara">Kwara</option>
                <option value="lagos">Lagos</option>
                <option value="nasarawa">Nasarawa</option>
                <option value="niger">Niger</option>
                <option value="ogun">Ogun</option>
                <option value="ondo">Ondo</option>
                <option value="osun">Osun</option>
                <option value="oyo">Oyo</option>
                <option value="plateau">Plateau</option>
                <option value="rivers">Rivers</option>
                <option value="sokoto">Sokoto</option>
                <option value="taraba">Taraba</option>
                <option value="yobe">Yobe</option>
                <option value="zamfara">Zamfara</option>
                {/* Add more states here */}
              </select>
              <div className="pointer-events-none pt-5 absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <LuChevronDown className="h-5 w-5" />
              </div>
            </div>
          </div>
          {/* Location input */}
          <div>
            <label htmlFor="location" className="block text-sm font-semibold text-gray-700 mb-1">
              Location
            </label>
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="Iwo road, Ibadan"
              className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>
          {formError && <p className="text-red-500 text-sm">{formError}</p>}
          <div className="p-6 border-t border-gray-200">
            <button
              type="submit"
              disabled={isCreating}
              className={`w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-md transition-colors ${
                isCreating
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-indigo-700'
              }`}
            >
              {isCreating ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Creating...
                </div>
              ) : (
                'Create branch'
              )}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};

  const handleExport = (format: string) => {
    if (!format || format === 'Export') return;
    if (format === 'PDF') {
      window.print();
      return;
    }
    // CSV export
    const headers = ['Branch Name', 'State', 'Location', 'Agents', 'Customers'];
    const rows = sortedBranches.map(b => [
      `"${b.name}"`,
      `"${b.state}"`,
      `"${b.location}"`,
      `"${b.agents}"`,
      `"${b.customers}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'branches.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(Number(event.target.value));
    setCurrentPage(1); // Reset to the first page when rows per page changes
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const renderPaginationButtons = () => {
    const pageButtons = [];
    const maxPageButtons = 5; // To show a limited number of buttons
    let startPage = Math.max(1, currentPage - Math.floor(maxPageButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);

    if (endPage - startPage + 1 < maxPageButtons) {
        startPage = Math.max(1, endPage - maxPageButtons + 1);
    }

    if (startPage > 1) {
        pageButtons.push(
            <button key="1" onClick={() => handlePageChange(1)} className={`w-10 h-10 rounded-md font-semibold transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200`}>1</button>
        );
        if (startPage > 2) {
            pageButtons.push(<span key="ellipsis-start" className="w-10 h-10 flex items-end justify-center text-gray-500">...</span>);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        pageButtons.push(
            <button 
                key={i}
                onClick={() => handlePageChange(i)}
                className={`w-10 h-10 rounded-md font-semibold transition-colors
                    ${currentPage === i ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                `}
            >
                {i}
            </button>
        );
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pageButtons.push(<span key="ellipsis-end" className="w-10 h-10 flex items-end justify-center text-gray-500">...</span>);
        }
        pageButtons.push(
            <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={`w-10 h-10 rounded-md font-semibold transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200`}>{totalPages}</button>
        );
    }

    return pageButtons;
  };

  return (
    <div className="min-h-screen font-sans antialiased">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mt-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Branch managment</h1>
          <p className="text-gray-600">Create, update and manage branch details</p>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(true)} // Open the sidebar
          className="flex items-center space-x-2 bg-[#6b47ff] text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-[#5a38e0] transition-colors mt-4 md:mt-0"
        >
          <Plus className="h-5 w-5" />
          <span>Create branch</span>
        </button>
      </div>

      {/* Control Panel Section */}
      <div className="bg-white p-6 shadow-sm mb-8">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between space-y-4 md:space-y-0 md:space-x-4">
          {/* Show rows dropdown (Left) */}
          <div className="relative w-full md:w-auto">
            <label htmlFor="show-rows" className="sr-only">Show rows per page</label>
            <select
              id="show-rows"
              className="block w-full rounded-lg border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
              value={rowsPerPage}
              onChange={handleRowsPerPageChange}
            >
              <option value={10}>Show 10 per row</option>
              <option value={20}>Show 20 per row</option>
              <option value={50}>Show 50 per row</option>
            </select>
            <div className="pointer-events-none pt-5 absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
              <LuChevronDown className="h-5 w-5" />
            </div>
          </div>

          {/* Export, Filter and Search (Right) */}
          <div className="flex flex-col md:flex-row w-full md:w-auto space-y-4 md:space-y-0 md:space-x-4 ml-0 md:ml-auto">
            {/* State Filter Dropdown */}
            <div className="relative w-full sm:w-auto">
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
              >
                <option value="">All States</option>
                <option value="Oyo">Oyo</option>
                <option value="Kwara">Kwara</option>
                <option value="Lagos">Lagos</option>
              </select>
              <div className="pointer-events-none absolute pt-5 inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <LuChevronDown className="h-5 w-5" />
              </div>
            </div>

            {/* Export Dropdown */}
            <div className="relative w-full sm:w-auto bg-[#e9e6ff] text-indigo-500 rounded-lg">
              <select
                className="block w-full bg-[#e9e6ff] appearance-none rounded-lg text-indigo-200 pl-4 pr-10 py-3 text-sm focus:outline-none"
                defaultValue="Export"
                onChange={(e) => { handleExport(e.target.value); e.target.value = 'Export'; }}
              >
                <option value="Export">Export</option>
                <option value="PDF">PDF</option>
                <option value="CSV">CSV</option>
              </select>
              <div className="pointer-events-none absolute pt-5 inset-y-0 right-0 flex items-center px-2 text-indigo-500">
                <LuChevronDown className="h-5 w-5" />
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-auto flex-grow">
              <label htmlFor="search-input" className="sr-only">Search</label>
              <div className="absolute inset-y-0 pt-5 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                id="search-input"
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 pl-10 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => requestSort('name')}
                >
                  <div className="flex items-center">
                    <span>Branch name</span>
                    {/* Render a sort icon based on sort state */}
                    {sortConfig.key === 'name' ? (
                      sortConfig.direction === 'ascending' ? (
                        <ArrowUp className="h-4 w-4 ml-2" />
                      ) : (
                        <ArrowDown className="h-4 w-4 ml-2" />
                      )
                    ) : (
                      <ChevronsUpDown className="h-4 w-4 ml-2 text-gray-400" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  State
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Location
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  No of agents
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  No of customers
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {currentBranches.map((branch) => (
                <tr key={branch.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {branch.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {branch.state}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {branch.location}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {branch.agents}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {branch.customers}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(branch.id)}
                      className="text-gray-500 hover:text-[#6b47ff] transition-colors"
                    >
                      <Edit className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Section */}
        <div className="p-6 flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0">
          <button 
            className="flex items-center space-x-2 text-gray-700 font-semibold py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
            disabled={currentPage === 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            <span>Previous</span>
          </button>
          <div className="flex space-x-2">
            {renderPaginationButtons()}
          </div>
          <button 
            className="flex items-center space-x-2 text-gray-700 font-semibold py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
            disabled={currentPage === totalPages || totalPages === 0}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            <span>Next</span>
          </button>
        </div>
      </div>
      
      {/* The sidebar component */}
      <CreateBranchSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
      />
      {/* The edit modal component */}
      <EditBranchModal />
    </div>
  );
}
