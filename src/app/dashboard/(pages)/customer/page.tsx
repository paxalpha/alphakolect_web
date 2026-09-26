"use client"
import { LuChevronDown, LuChevronUp, LuX, LuPlus, LuArrowUpDown } from 'react-icons/lu';
import React from 'react';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';



import { useEffect } from 'react';
import Swal from 'sweetalert2';
import { fetchAgents, fetchBranches, addCustomer, fetchPackages, updateCustomer } from '../../../../../services/api';

const AddCustomerSidebar: React.FC<{ isOpen: boolean; onClose: () => void; onCustomerAdded?: () => void }> = ({ isOpen, onClose, onCustomerAdded }) => {
    const [formState, setFormState] = useState({
        branch: '',
        agent: '',
        fullName: '',
        alias: '',
        package: '',
        packageId: '',
        phoneNumber: '',
        address: '',
        email: '',
        accountNumber: '',
    });
    const [branches, setBranches] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [packages, setPackages] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        // Fetch branches, agents, and packages when sidebar opens
        setLoading(true);
        Promise.all([
            fetchBranches().catch(() => []),
            fetchAgents().catch(() => []),
            fetchPackages('Collection').catch(() => [])
        ]).then(([branchesRes, agentsRes, packagesRes]) => {
            setBranches(branchesRes?.branches || branchesRes || []);
            setAgents(agentsRes?.agents || agentsRes || []);
            // Show only collection packages
            setPackages(packagesRes?.packages || packagesRes || []);
        }).finally(() => setLoading(false));
    }, [isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { id, value } = e.target;
        if (id === 'branch') {
            // Reset agent when branch changes
            setFormState(prev => ({ ...prev, branch: value, agent: '' }));
        } else if (id === 'package') {
            const selectedPkg = packages.find((p: any) => p.name === value);
            setFormState(prev => ({
                ...prev,
                package: value,
                packageId: selectedPkg ? String(selectedPkg.id) : '',
            }));
        } else {
            setFormState(prev => ({ ...prev, [id]: value }));
        }
    };

    // Filter agents to only those belonging to the selected branch
    const filteredAgents = formState.branch
        ? agents.filter((a: any) => {
            const agentBranch = (a.branch || '').toLowerCase().trim();
            const selectedBranch = formState.branch.toLowerCase().trim();
            return agentBranch === selectedBranch;
        })
        : agents;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Find agent and branch IDs
        const selectedAgent = agents.find(a => a.fullName === formState.agent || a.name === formState.agent);
        const selectedBranch = branches.find(b => b.name === formState.branch);
        if (!selectedAgent || !selectedBranch) {
            Swal.fire({ icon: 'error', title: 'Please select valid agent and branch.' });
            return;
        }
        try {
            setLoading(true);
            await addCustomer({
                fullName: formState.fullName,
                phoneNumber: formState.phoneNumber,
                email: formState.email,
                agentId: selectedAgent.id?.toString() || selectedAgent._id || '',
                branchId: selectedBranch.id?.toString() || selectedBranch._id || '',
                accountNumber: formState.accountNumber || undefined,
                alias: formState.alias || undefined,
                address: formState.address || undefined,
                packageId: formState.packageId || undefined,
            });
            Swal.fire({ icon: 'success', title: 'Customer added successfully!' });
            setFormState({ branch: '', agent: '', fullName: '', alias: '', package: '', packageId: '', phoneNumber: '', address: '', email: '', accountNumber: '' });
            onClose();
            // Trigger refresh of customers list
            if (onCustomerAdded) {
                onCustomerAdded();
            }
        } catch (err: any) {
            Swal.fire({ icon: 'error', title: 'Failed to add customer', text: err?.message || 'An error occurred.' });
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-gray-900/50 z-40"
                onClick={onClose}
                aria-hidden="true"
            />

            <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-xl z-50 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-800">Add customer</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <LuX className="h-6 w-6" />
                    </button>
                </div>

                {/* Form Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Branch */}
                        <div>
                            <label htmlFor="branch" className="block text-sm font-semibold text-gray-700 mb-1">
                                Branch
                            </label>
                            <div className="relative">
                                <select
                                    id="branch"
                                    value={formState.branch}
                                    onChange={handleChange}
                                    className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
                                    disabled={loading}
                                >
                                    <option value="">Select branch</option>
                                    {branches.map((b) => (
                                        <option key={b.id || b._id} value={b.name}>{b.name}</option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                                    <LuChevronDown className="h-5 w-5" />
                                </div>
                            </div>
                        </div>

                        {/* Agent */}
                        <div>
                            <label htmlFor="agent" className="block text-sm font-semibold text-gray-700 mb-1">
                                Agent
                            </label>
                            <div className="relative">
                                <select
                                    id="agent"
                                    value={formState.agent}
                                    onChange={handleChange}
                                    className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer disabled:bg-gray-50 disabled:text-gray-400"
                                    disabled={loading || !formState.branch}
                                >
                                    <option value="">
                                        {!formState.branch ? 'Select branch first' : filteredAgents.length === 0 ? 'No agents in this branch' : 'Select Agent'}
                                    </option>
                                    {filteredAgents.map((a: any) => (
                                        <option key={a.id || a._id} value={a.fullName || a.name}>{a.fullName || a.name}</option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                                    <LuChevronDown className="h-5 w-5" />
                                </div>
                            </div>
                        </div>

                        {/* Account Number (optional) */}
                        <div>
                            <label htmlFor="accountNumber" className="block text-sm font-semibold text-gray-700 mb-1">
                                Account number (optional)
                            </label>
                            <input
                                type="text"
                                id="accountNumber"
                                value={formState.accountNumber}
                                onChange={handleChange}
                                placeholder="Auto-generated if left blank"
                                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>

                        {/* Full name */}
                        <div>
                            <label htmlFor="fullName" className="block text-sm font-semibold text-gray-700 mb-1">
                                Full name
                            </label>
                            <input
                                type="text"
                                id="fullName"
                                value={formState.fullName}
                                onChange={handleChange}
                                placeholder="John doe"
                                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>

                        {/* Alias */}
                        <div>
                            <label htmlFor="alias" className="block text-sm font-semibold text-gray-700 mb-1">
                                Alias
                            </label>
                            <input
                                type="text"
                                id="alias"
                                value={formState.alias}
                                onChange={handleChange}
                                placeholder="johndoebuddy"
                                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>

                        {/* Package */}
                        <div>
                            <label htmlFor="package" className="block text-sm font-semibold text-gray-700 mb-1">
                                Package
                            </label>
                            <div className="relative">
                                <select
                                    id="package"
                                    value={formState.package}
                                    onChange={handleChange}
                                    className="block w-full rounded-md border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
                                >
                                    <option value="">Select package</option>
                                    {packages.map((pkg) => (
                                        <option key={pkg.id} value={pkg.name}>
                                            {pkg.name} - ₦{pkg.amount?.toLocaleString()}
                                        </option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                                    <LuChevronDown className="h-5 w-5" />
                                </div>
                            </div>
                        </div>

                        {/* Phone number */}
                        <div>
                            <label htmlFor="phoneNumber" className="block text-sm font-semibold text-gray-700 mb-1">
                                Phone number
                            </label>
                            <input
                                type="text"
                                id="phoneNumber"
                                value={formState.phoneNumber}
                                onChange={handleChange}
                                placeholder="John doe" // This placeholder seems to be a typo in the original image, but I'll keep it for consistency.
                                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>

                        {/* Address */}
                        <div>
                            <label htmlFor="address" className="block text-sm font-semibold text-gray-700 mb-1">
                                Address
                            </label>
                            <input
                                type="text"
                                id="address"
                                value={formState.address}
                                onChange={handleChange}
                                placeholder="1, King street, Ikeja, Lagos. Nigeria"
                                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>

                        {/* Email */}
                        <div>
                            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                id="email"
                                value={formState.email}
                                onChange={handleChange}
                                placeholder="johndoe@example.com"
                                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>
                    </form>
                </div>

                {/* Footer with buttons */}
                <div className="p-6 border-t border-gray-200">
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        className="w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition-colors"
                        disabled={loading}
                    >
                        {loading ? 'Adding...' : 'Add customer'}
                    </button>
                </div>
            </div>
        </>
    );
};


import { fetchCustomers } from '../../../../../services/api';

const ReassignSidebar: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    agents: any[];
    branches: any[];
    onSubmit: (agentId: string, branchId: string) => Promise<void>;
    loading: boolean;
    count: number;
}> = ({ isOpen, onClose, agents, branches, onSubmit, loading, count }) => {
    const [agentId, setAgentId] = useState('');
    const [branchId, setBranchId] = useState('');

    useEffect(() => {
        if (isOpen) {
            setAgentId('');
            setBranchId('');
        }
    }, [isOpen]);

    // Filter agents by selected branch
    // Check by branch name, branchId, branch_id, or branch string ID
    const selectedBranchObj = branches.find((b: any) => String(b.id) === branchId || String(b.branchId) === branchId);
    const selectedBranchName = selectedBranchObj
        ? (selectedBranchObj.name || selectedBranchObj.branchName || '').toLowerCase().trim()
        : '';

    const filteredAgents = branchId
        ? agents.filter((a: any) => {
            const agentBranchName = (a.branch || a.branchName || '').toLowerCase().trim();
            const agentBranchId = String(a.branchId || a.branch_id || '');
            if (selectedBranchName && agentBranchName === selectedBranchName) return true;
            if (agentBranchId && agentBranchId === branchId) return true;
            return false;
        })
        : agents;

    const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setBranchId(e.target.value);
        setAgentId(''); // reset agent whenever branch changes
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} aria-hidden="true" />
            <aside className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-xl z-50 flex flex-col">
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">Reassign customers</h2>
                    <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <LuX className="h-6 w-6" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    <p className="text-sm text-gray-500">{count} customer(s) selected</p>

                    {/* Branch first */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Assign to branch</label>
                        <select value={branchId} onChange={handleBranchChange} className="block w-full rounded-md border border-gray-300 px-4 py-3 text-sm">
                            <option value="">Select branch</option>
                            {branches.map((b) => (
                                <option key={b.id} value={b.id}>{b.name || b.branchName}</option>
                            ))}
                        </select>
                    </div>

                    {/* Agent second — filtered by branch */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">
                            Assign to agent
                            {branchId && filteredAgents.length === 0 && (
                                <span className="ml-2 text-xs font-normal text-amber-600">(No agents in this branch)</span>
                            )}
                        </label>
                        <select
                            value={agentId}
                            onChange={(e) => setAgentId(e.target.value)}
                            className="block w-full rounded-md border border-gray-300 px-4 py-3 text-sm"
                        >
                            <option value="">Select agent (optional if assigning branch)</option>
                            {filteredAgents.map((a) => (
                                <option key={a.id} value={a.id}>{a.fullName || a.name}</option>
                            ))}
                        </select>
                        {branchId && filteredAgents.length > 0 && (
                            <p className="text-xs text-gray-400 mt-1">{filteredAgents.length} agent(s) in this branch</p>
                        )}
                    </div>
                </div>
                <div className="p-6 border-t">
                    <button
                        type="button"
                        disabled={loading || (!agentId && !branchId)}
                        onClick={() => onSubmit(agentId, branchId)}
                        className="w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {loading ? 'Updating...' : 'Update assignment'}
                    </button>
                </div>
            </aside>
        </>
    );
};

export default function CustomersPage() {
    const [customers, setCustomers] = useState<any[]>([]);
    const [selectedCustomers, setSelectedCustomers] = useState<any>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isReassignOpen, setIsReassignOpen] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterBranch, setFilterBranch] = useState('');
    const [filterAgent, setFilterAgent] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [agents, setAgents] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [sortConfig, setSortConfig] = useState<any>({ key: null, direction: 'ascending' });
    const [loading, setLoading] = useState(false);
    const [reassignLoading, setReassignLoading] = useState(false);

    const refreshCustomers = () => {
        setLoading(true);
        fetchCustomers()
            .then((res) => {
                setCustomers(res.customers || res || []);
            })
            .catch(() => setCustomers([]))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        refreshCustomers();
        Promise.all([fetchAgents().catch(() => []), fetchBranches().catch(() => [])]).then(([agentsRes, branchesRes]) => {
            setAgents(agentsRes?.agents || agentsRes || []);
            setBranches(branchesRes?.branches || branchesRes || []);
        });
    }, []);

    const filteredCustomers = useMemo(() => {
        return customers.filter((c) => {
            const haystack = [
                c.fullName, c.name, c.account, c.accountNumber,
                c.branchName, c.branch?.name, c.agentName, c.agent?.fullName,
                c.packageName, c.status
            ].map((v) => String(v || '').toLowerCase()).join(' ');
            const matchesSearch = !searchQuery || haystack.includes(searchQuery.toLowerCase());
            const branchVal = c.branchName || c.branch?.name || '';
            const agentVal = c.agentName || c.agent?.fullName || c.agent?.name || '';
            const matchesBranch = !filterBranch || branchVal === filterBranch;
            const matchesAgent = !filterAgent || agentVal === filterAgent;
            const matchesStatus = !filterStatus || c.status === filterStatus;
            return matchesSearch && matchesBranch && matchesAgent && matchesStatus;
        });
    }, [customers, searchQuery, filterBranch, filterAgent, filterStatus]);

    const sortedCustomers = useMemo(() => {
        let sortableItems = [...filteredCustomers];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                if (sortConfig.key === 'date') {
                    const dateA = new Date(a.date?.replace(/,/, '') + ' ' + a.time);
                    const dateB = new Date(b.date?.replace(/,/, '') + ' ' + b.time);
                    if (dateA < dateB) {
                        return sortConfig.direction === 'ascending' ? -1 : 1;
                    }
                    if (dateA > dateB) {
                        return sortConfig.direction === 'ascending' ? 1 : -1;
                    }
                    return 0;
                }
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredCustomers, sortConfig]);

    const uniqueBranches = useMemo(() => {
        const names = customers.map((c) => c.branchName || c.branch?.name).filter(Boolean);
        return [...new Set(names)] as string[];
    }, [customers]);

    const uniqueAgents = useMemo(() => {
        const names = customers.map((c) => c.agentName || c.agent?.fullName || c.agent?.name).filter(Boolean);
        return [...new Set(names)] as string[];
    }, [customers]);

    const handleExport = (format: string) => {
        if (format === 'CSV') {
            const headers = ['Account Number', 'Full Name', 'Branch', 'Agent', 'Package', 'Date Created', 'Status'];
            const rows = sortedCustomers.map((c) => [
                c.account || c.accountNumber || '',
                c.name || c.fullName || '',
                c.branchName || c.branch?.name || '',
                c.agentName || c.agent?.fullName || '',
                c.packageName || c.package || '',
                c.date || (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''),
                c.status || '',
            ]);
            const csv = [headers, ...rows]
                .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                .join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `customers_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } else if (format === 'PDF') {
            window.print();
        }
    };

    const handleBulkReassign = async (agentId: string, branchId: string) => {
        setReassignLoading(true);
        try {
            await Promise.all(
                selectedCustomers.map((id: number) =>
                    updateCustomer(id, {
                        ...(agentId ? { agentId } : {}),
                        ...(branchId ? { branchId } : {}),
                    })
                )
            );
            Swal.fire({ icon: 'success', title: 'Customers reassigned successfully' });
            setIsReassignOpen(false);
            setSelectedCustomers([]);
            refreshCustomers();
        } catch (err: any) {
            Swal.fire({ icon: 'error', title: 'Reassign failed', text: err?.message || 'Could not reassign customers' });
        } finally {
            setReassignLoading(false);
        }
    };

    // Pagination logic now uses the sorted data
    const totalPages: number = Math.ceil(sortedCustomers.length / itemsPerPage);
    const lastIndex = currentPage * itemsPerPage;
    const firstIndex = lastIndex - itemsPerPage;
    const currentCustomers = sortedCustomers.slice(firstIndex, lastIndex);

    // Function to handle sorting
    const handleSort = (key: any) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const handleSelectAll = (e: any) => {
        if (e.target.checked) {
            setSelectedCustomers(currentCustomers.map((customer: any) => customer.id));
        } else {
            setSelectedCustomers([]);
        }
    };

    const handleSelectCustomer = (id: any) => {
        setSelectedCustomers((prevSelected: any) =>
            prevSelected.includes(id)
                ? prevSelected.filter((customerId: any) => customerId !== id)
                : [...prevSelected, id]
        );
    };

    const areAllSelected = currentCustomers.length > 0 && selectedCustomers.length === currentCustomers.length;

    const isCustomerSelected = (id: any) => selectedCustomers.includes(id);

    const handlePageChange = (pageNumber: any) => {
        setCurrentPage(pageNumber);
    };

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            setCurrentPage(currentPage + 1);
        }
    };

    const handlePreviousPage = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1);
        }
    };

    // Helper function to render the correct sort icon
    const renderSortIcon = (key: any) => {
        if (sortConfig.key !== key) {
            return <>
                <div className="flex flex-col text-gray-300">
                  <ChevronUp className="h-4 w-4 mb-[-4px]" />
                  <ChevronDown className="h-4 w-4" />
                </div>
            </>;
        }
        if (sortConfig.direction === 'ascending') {
            return <ChevronUp className="h-4 w-4 mb-[-4px]" />;
        }
        return <ChevronDown className="h-4 w-4" />;
    };

    return (
        <div className="font-sans min-h-screen p-6 bg-gray-50">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Customers</h1>
                    <p className="text-gray-500 mt-1">View and manage all your customers. Track their activity, status, and key details</p>
                </div>
                <div className="flex items-center justify-end space-x-2 w-full">
                    <div className="relative w-full sm:w-auto bg-[#e9e6ff] text-indigo-500 rounded-lg">
                        <select
                            className="block w-full bg-[#e9e6ff] appearance-none rounded-lg text-indigo-500 pl-4 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
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
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-indigo-500 pt-5">
                            <LuChevronDown className="h-5 w-5" />
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsSidebarOpen(true)}
                        aria-label="Add customer"
                        className="flex items-center px-4 py-3 bg-indigo-600 text-white rounded-lg shadow-sm font-medium text-sm hover:bg-indigo-700 transition-colors"
                    >
                        <LuPlus className="h-4 w-4 mr-0 sm:mr-1" />
                        <span className="hidden sm:inline">Add customer</span>
                    </button>
                </div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                    <div className="flex w-full lg:w-auto items-stretch lg:items-center gap-4">
                        <button
                            type="button"
                            onClick={() => setShowFilters((v) => !v)}
                            className={`flex items-center justify-center gap-2 px-3 py-2 border rounded-md text-sm transition-colors w-full lg:w-auto ${
                                showFilters ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            <img src="/icons/filter.png" alt="" />
                            Filter
                        </button>
                        <div className="flex items-center rounded-md border border-gray-300 shadow-sm p-1.5 focus:ring-indigo-500 focus:border-indigo-500 w-full lg:w-auto">
                            <label htmlFor="rows-per-page" className="text-sm text-gray-700 mr-2">Show</label>
                            <select id="rows-per-page" className="text-sm w-full lg:w-auto" value={itemsPerPage} onChange={e => setItemsPerPage(parseInt(e.target.value))}>
                                <option value={10}>10 per row</option>
                                <option value={25}>25 per row</option>
                                <option value={50}>50 per row</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex w-full lg:w-auto items-stretch lg:items-center gap-4">
                        <button
                            type="button"
                            onClick={() => {
                                if (selectedCustomers.length === 0) {
                                    Swal.fire({
                                        icon: 'info',
                                        title: 'Select Customers',
                                        text: 'Please select one or more customers using the checkboxes on the left before clicking Reassign.',
                                        confirmButtonColor: '#4F46E5'
                                    });
                                    return;
                                }
                                setIsReassignOpen(true);
                            }}
                            className={`px-3 py-2 border rounded-md text-sm transition-colors w-full lg:w-auto ${
                                selectedCustomers.length === 0
                                    ? 'border-gray-300 text-gray-600 hover:bg-gray-100 cursor-pointer'
                                    : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium'
                            }`}
                        >
                            Reassign{selectedCustomers.length > 0 ? ` (${selectedCustomers.length})` : ''}
                        </button>
                        <div className="relative w-full lg:w-64">
                            <input
                                type="text"
                                placeholder="Search"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="pl-8 pr-4 border py-2 w-full text-sm rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>
                </div>

                {showFilters && (
                    <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Branch</label>
                            <select value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setCurrentPage(1); }} className="w-full border rounded-md px-3 py-2 text-sm">
                                <option value="">All branches</option>
                                {uniqueBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Agent</label>
                            <select value={filterAgent} onChange={(e) => { setFilterAgent(e.target.value); setCurrentPage(1); }} className="w-full border rounded-md px-3 py-2 text-sm">
                                <option value="">All agents</option>
                                {uniqueAgents.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Status</label>
                            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }} className="w-full border rounded-md px-3 py-2 text-sm">
                                <option value="">All status</option>
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 table-auto">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="p-4"><input type="checkbox" checked={areAllSelected} onChange={handleSelectAll} /></th>
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('account')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Account number</span>
                                    {renderSortIcon('account')}
                                </div>
                            </th>
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('name')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Full name</span>
                                    {renderSortIcon('name')}
                                </div>
                            </th>
                            {/* <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('alias')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Alias</span>
                                    {renderSortIcon('alias')}
                                </div>
                            </th> */}
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('branch')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Branch</span>
                                    {renderSortIcon('branch')}
                                </div>
                            </th>
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('agent')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Agent</span>
                                    {renderSortIcon('agent')}
                                </div>
                            </th>
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('package')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Package</span>
                                    {renderSortIcon('package')}
                                </div>
                            </th>
                            {/* <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('address')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Address</span>
                                    {renderSortIcon('address')}
                                </div>
                            </th> */}
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('date')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Date created</span>
                                    {renderSortIcon('date')}
                                </div>
                            </th>
                            <th className="px-4 py-2 text-left text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('status')}>
                                <div className="flex items-center">
                                    <span className="text-xs font-semibold">Status</span>
                                    {renderSortIcon('status')}
                                </div>
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {currentCustomers.map((c: any) => (
                            <tr key={c.id} className={selectedCustomers.includes(c.id) ? 'bg-indigo-50' : ''}>
                                <td className="p-4"><input type="checkbox" checked={selectedCustomers.includes(c.id)} onChange={() => handleSelectCustomer(c.id)} /></td>
                                <td className="px-4 py-2 text-sm text-gray-900">{c.account || c.accountNumber || ''}</td>
                                <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[150px]">{c.name || c.fullName || ''}</td>
                                {/* <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[150px]">{c.alias || ''}</td> */}
                                <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[150px]">{c.branchName || c.branch?.name || ''}</td>
                                <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[150px]">{c.agentName || c.agent?.fullName || c.agent?.name || ''}</td>
                                <td className="px-4 py-2 text-sm text-gray-700">{c.packageName || c.package_name || c.Package || c.package || c.packageTitle || c.subscriptionPackage || '—'}</td>
                                {/* <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[200px]">{c.address || ''}</td> */}
                                <td className="px-4 py-2 text-sm text-gray-700">{c.date || c.createdAt ? new Date(c.date || c.createdAt).toLocaleDateString() : ''}{c.time ? `, ${c.time}` : ''}</td>
                                <td className="px-4 py-2 text-sm">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {c.status}
                                    </span>
                                </td>
                                <td className="px-4 py-2 text-right">
                                    <Link href={`/dashboard/customer/${c.id}`} className="px-4 py-2 rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50 transition-colors text-sm font-medium">
                                        View
                                    </Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 p-4 bg-white rounded-lg shadow-sm border-gray-200">
                <button
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                    className="flex items-center text-gray-500 hover:text-indigo-600 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                </button>
                <div className="flex items-center space-x-1">
                    {[...Array(totalPages)].map((_, index) => (
                        <button
                            key={index + 1}
                            onClick={() => handlePageChange(index + 1)}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors
                                ${currentPage === index + 1 ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                        >
                            {index + 1}
                        </button>
                    ))}
                </div>
                <button
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                    className="flex items-center text-gray-500 hover:text-indigo-600 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                >
                    Next
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>

            <AddCustomerSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} onCustomerAdded={refreshCustomers} />
            <ReassignSidebar
                isOpen={isReassignOpen}
                onClose={() => setIsReassignOpen(false)}
                agents={agents}
                branches={branches}
                count={selectedCustomers.length}
                loading={reassignLoading}
                onSubmit={handleBulkReassign}
            />
        </div>
    );
}

