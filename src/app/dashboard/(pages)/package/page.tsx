"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Package, Users, Calendar, X, ChevronDown, Layers } from 'lucide-react';
import { fetchPackages, createPackage } from '../../../../../services/api';
import Swal from 'sweetalert2';

type PackageCategory = 'Collection' | 'Loan' | 'Investment';

interface PackageType {
  id: number;
  name: string;
  amount: number;
  duration: number;
  benefits: string[];
  status: 'Active' | 'Inactive';
  dateCreated: string;
  packageCategory: PackageCategory;
}

const CATEGORIES: PackageCategory[] = ['Collection', 'Loan', 'Investment'];

const CATEGORY_COLORS: Record<PackageCategory, { tab: string; badge: string; icon: string }> = {
  Collection: {
    tab: 'border-blue-600 text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
    icon: 'text-blue-600 bg-blue-100',
  },
  Loan: {
    tab: 'border-purple-600 text-purple-600',
    badge: 'bg-purple-100 text-purple-700',
    icon: 'text-purple-600 bg-purple-100',
  },
  Investment: {
    tab: 'border-emerald-600 text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700',
    icon: 'text-emerald-600 bg-emerald-100',
  },
};

const CreatePackageModal = ({
  isOpen,
  onClose,
  onSuccess,
  defaultCategory,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultCategory: PackageCategory;
}) => {
  const [formData, setFormData] = useState({
    name: '',
    amount: '',
    duration: '',
    packageCategory: defaultCategory,
    benefits: [''],
  });
  const [loading, setLoading] = useState(false);

  // Sync defaultCategory when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData((prev) => ({ ...prev, packageCategory: defaultCategory }));
    }
  }, [isOpen, defaultCategory]);

  const handleBenefitChange = (index: number, value: string) => {
    const newBenefits = [...formData.benefits];
    newBenefits[index] = value;
    setFormData({ ...formData, benefits: newBenefits });
  };

  const addBenefit = () => {
    setFormData({ ...formData, benefits: [...formData.benefits, ''] });
  };

  const removeBenefit = (index: number) => {
    const newBenefits = formData.benefits.filter((_, i) => i !== index);
    setFormData({ ...formData, benefits: newBenefits });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const filteredBenefits = formData.benefits.filter((b) => b.trim() !== '');
      await createPackage({
        name: formData.name,
        type: 'General',
        amount: parseFloat(formData.amount),
        seedAmount: 0,
        seedType: 'fixed',
        period: 1,
        collectionDays: 'Mon,Tue,Wed,Thu,Fri',
        duration: parseInt(formData.duration, 10),
        benefits: filteredBenefits,
        packageCategory: formData.packageCategory,
      });
      Swal.fire({ icon: 'success', title: 'Package Created', text: 'Package has been created successfully.' });
      setFormData({ name: '', amount: '', duration: '', packageCategory: defaultCategory, benefits: [''] });
      onSuccess();
      onClose();
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Failed to create package.' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Create Package</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Package Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Package Category</label>
            <select
              value={formData.packageCategory}
              onChange={(e) => setFormData({ ...formData, packageCategory: e.target.value as PackageCategory })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            >
              <option value="Collection">Collection</option>
              <option value="Loan">Loan</option>
              <option value="Investment">Investment</option>
            </select>
          </div>
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Package Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (Days)</label>
            <input
              type="number"
              value={formData.duration}
              onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          {/* Benefits */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Benefits</label>
            {formData.benefits.map((benefit, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={benefit}
                  onChange={(e) => handleBenefitChange(index, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter benefit"
                />
                {formData.benefits.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBenefit(index)}
                    className="px-3 py-2 text-red-600 border border-red-300 rounded-md hover:bg-red-50"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addBenefit} className="text-indigo-600 text-sm hover:text-indigo-800">
              + Add Benefit
            </button>
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Package'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default function PackagePage() {
  const [allPackages, setAllPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PackageCategory>('Collection');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response: any = await fetchPackages();
      setAllPackages(response.packages || []);
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Failed to fetch packages.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Reset page when tab/search/filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm, filterStatus]);

  // Packages for the active tab
  const tabPackages = useMemo(
    () => allPackages.filter((pkg) => pkg.packageCategory === activeTab),
    [allPackages, activeTab]
  );

  const filteredPackages = useMemo(() => {
    return tabPackages.filter((pkg) => {
      const matchesSearch = pkg.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filterStatus === 'all' || pkg.status === filterStatus;
      return matchesSearch && matchesFilter;
    });
  }, [tabPackages, searchTerm, filterStatus]);

  const paginatedPackages = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredPackages.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredPackages, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredPackages.length / itemsPerPage);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active':
        return 'bg-green-100 text-green-800';
      case 'Inactive':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleExport = (format: string) => {
    if (format === 'CSV') {
      const headers = ['Package ID', 'Package Name', 'Category', 'Amount', 'Duration', 'Benefits', 'Status', 'Date Created'];
      const rows = filteredPackages.map((pkg) => [
        pkg.id, pkg.name, pkg.packageCategory, pkg.amount, pkg.duration,
        pkg.benefits.join('; '), pkg.status,
        pkg.dateCreated ? new Date(pkg.dateCreated).toLocaleDateString() : '',
      ]);
      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `packages_${activeTab.toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } else if (format === 'PDF') {
      window.print();
    }
  };

  // Summary counts per category
  const counts = useMemo(() => {
    const c: Record<PackageCategory, number> = { Collection: 0, Loan: 0, Investment: 0 };
    allPackages.forEach((pkg) => { c[pkg.packageCategory] = (c[pkg.packageCategory] || 0) + 1; });
    return c;
  }, [allPackages]);

  const activeCount = tabPackages.filter((p) => p.status === 'Active').length;
  const inactiveCount = tabPackages.filter((p) => p.status === 'Inactive').length;

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Packages</h1>
            <p className="text-gray-600 mt-1">Manage service packages for Collection, Loan, and Investment</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="mt-4 md:mt-0 bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700"
          >
            <Plus size={20} />
            New Package
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {CATEGORIES.map((cat) => (
            <div
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`bg-white p-6 rounded-lg shadow-sm border cursor-pointer transition-all hover:shadow-md ${activeTab === cat ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{cat} Packages</p>
                  <p className="text-2xl font-bold text-gray-900">{counts[cat]}</p>
                </div>
                <div className={`p-3 rounded-full ${CATEGORY_COLORS[cat].icon}`}>
                  <Layers className="h-6 w-6" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Active / Inactive for current tab */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white p-5 rounded-lg shadow-sm border flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active</p>
              <p className="text-2xl font-bold text-green-600">{activeCount}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <Users className="h-6 w-6 text-green-600" />
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm border flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Inactive</p>
              <p className="text-2xl font-bold text-red-600">{inactiveCount}</p>
            </div>
            <div className="p-3 bg-red-100 rounded-full">
              <X className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-4">
          <nav className="flex gap-6">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === cat
                    ? CATEGORY_COLORS[cat].tab
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {cat}
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[cat].badge}`}>
                  {counts[cat]}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex flex-col md:flex-row gap-4 items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder={`Search ${activeTab} packages...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div className="flex gap-2">
              <div className="relative bg-[#e9e6ff] text-indigo-500 rounded-lg">
                <select
                  className="block bg-[#e9e6ff] appearance-none rounded-lg text-indigo-500 pl-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer border border-indigo-200"
                  defaultValue=""
                  onChange={(e) => { const val = e.target.value; if (val) handleExport(val); e.target.value = ''; }}
                >
                  <option value="" disabled>Export</option>
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-indigo-500">
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Table or Empty State */}
        {tabPackages.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-16 text-center">
            <div className="flex justify-center mb-4">
              <div className={`p-5 rounded-full ${CATEGORY_COLORS[activeTab].icon}`}>
                <Package className="h-12 w-12" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">No {activeTab} Packages Yet</h3>
            <p className="text-gray-500 mb-6">
              There are no packages created for <strong>{activeTab}</strong>. Click the button below to create one.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 mx-auto"
            >
              <Plus size={18} />
              Create {activeTab} Package
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Benefits</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Created</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedPackages.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                        No packages match your search/filter.
                      </td>
                    </tr>
                  ) : paginatedPackages.map((pkg) => (
                    <tr key={pkg.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">#{pkg.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{pkg.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{formatCurrency(pkg.amount)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pkg.duration} days</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="max-w-xs">
                          {pkg.benefits.slice(0, 2).map((benefit, index) => (
                            <div key={index} className="text-xs bg-gray-100 rounded px-2 py-1 mb-1">{benefit}</div>
                          ))}
                          {pkg.benefits.length > 2 && (
                            <div className="text-xs text-gray-400">+{pkg.benefits.length - 2} more</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(pkg.status)}`}>
                          {pkg.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(pkg.dateCreated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200">
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-700">
                    Showing{' '}
                    <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                    <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredPackages.length)}</span> of{' '}
                    <span className="font-medium">{filteredPackages.length}</span> results
                  </p>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >Previous</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          page === currentPage
                            ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >{page}</button>
                    ))}
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >Next</button>
                  </nav>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <CreatePackageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchData}
        defaultCategory={activeTab}
      />
    </div>
  );
}
