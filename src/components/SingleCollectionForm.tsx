"use client";
import React, { useState, useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';
import { fetchCustomers, fetchPackages, createCollection } from '@/services/api';
import Swal from 'sweetalert2';

interface SingleCollectionFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface Customer {
  id: number;
  fullName: string;
  accountNumber?: string;
  packageId?: number | string;
  packageName?: string;
}

interface Package {
  id: number;
  name: string;
  amount: number;
  packageCategory?: string;
}

const SingleCollectionForm: React.FC<SingleCollectionFormProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [formData, setFormData] = useState({
    customerName: '',
    selectedCustomerId: '',
    packageName: '',
    selectedPackageId: '',
    packageAmount: '',
    cycle: 31,
    cycleCounter: 1,
    dueDate: new Date().toISOString().split('T')[0]
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      setFormData(prev => ({
        ...prev,
        dueDate: new Date().toISOString().split('T')[0]
      }));
    }
  }, [isOpen]);

  const fetchData = async () => {
    try {
      const [customersRes, packagesRes] = await Promise.all([
        fetchCustomers().catch(() => ({ customers: [] })),
        fetchPackages('Collection').catch(() => [])
      ]);

      const rawCusts = customersRes.customers || customersRes.data || customersRes || [];
      setCustomers(Array.isArray(rawCusts) ? rawCusts : []);

      const rawPkgs = (packagesRes.packages || packagesRes.data || packagesRes || []) as Package[];
      const collectionPkgs = (Array.isArray(rawPkgs) ? rawPkgs : []).filter(
        (p: any) => !p.packageCategory || p.packageCategory.toLowerCase() === 'collection'
      );
      setPackages(collectionPkgs);
    } catch (error) {
      console.error('Failed to fetch collection form data:', error);
    }
  };

  const handleCustomerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const custId = e.target.value;
    if (!custId) {
      setFormData(prev => ({
        ...prev,
        selectedCustomerId: '',
        customerName: '',
        selectedPackageId: '',
        packageName: '',
        packageAmount: ''
      }));
      return;
    }

    const customer = customers.find(c => c.id.toString() === custId);
    if (!customer) return;

    let assignedPkg = null;
    const pkgId = customer.packageId || (customer as any).package_id || (customer as any).PackageId || (customer as any).Package?.id;
    if (pkgId) {
      assignedPkg = packages.find(p => p.id.toString() === pkgId.toString());
    }
    if (!assignedPkg && customer.packageName && customer.packageName !== '—' && customer.packageName !== '-') {
      assignedPkg = packages.find(p => p.name.toLowerCase() === customer.packageName!.toLowerCase());
    }

    const selectedPkg = assignedPkg || (packages.length > 0 ? packages[0] : null);

    setFormData(prev => ({
      ...prev,
      selectedCustomerId: customer.id.toString(),
      customerName: customer.fullName || (customer as any).name || '',
      selectedPackageId: selectedPkg ? selectedPkg.id.toString() : '',
      packageName: selectedPkg ? selectedPkg.name : '',
      packageAmount: selectedPkg ? selectedPkg.amount.toString() : ''
    }));
  };

  const handlePackageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const packageId = e.target.value;
    const selectedPackage = packages.find(pkg => pkg.id.toString() === packageId);
    setFormData(prev => ({
      ...prev,
      selectedPackageId: packageId,
      packageName: selectedPackage?.name || '',
      packageAmount: selectedPackage ? selectedPackage.amount.toString() : prev.packageAmount
    }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerName || !formData.packageName || !formData.packageAmount) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please fill in all required fields.'
      });
      return;
    }

    setLoading(true);
    try {
      const collectionData = {
        customerName: formData.customerName,
        amount: parseFloat(formData.packageAmount),
        dueDate: formData.dueDate || new Date().toISOString().split('T')[0],
        type: 'Package Payment',
        packageName: formData.packageName,
        packageAmount: parseFloat(formData.packageAmount),
        cycle: parseInt(formData.cycle.toString()) || 31,
        cycleCounter: parseInt(formData.cycleCounter.toString()) || 1,
        isFirstCollection: parseInt(formData.cycleCounter.toString()) === 1
      };

      await createCollection(collectionData);
      
      Swal.fire({
        icon: 'success',
        title: 'Success',
        text: 'Single collection posted successfully!'
      });
      
      onSuccess();
      onClose();
    } catch (error: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to post single collection'
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            Post Single Collection
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <FaTimes size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer Name *
            </label>
            <select
              name="selectedCustomerId"
              value={formData.selectedCustomerId}
              onChange={handleCustomerChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              required
            >
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName || (c as any).name}{c.accountNumber ? ` • ${c.accountNumber}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Package Name *
            </label>
            <select
              name="selectedPackageId"
              value={formData.selectedPackageId}
              onChange={handlePackageChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              required
            >
              {packages.length === 0 ? (
                <option value="">No Collection package created yet</option>
              ) : (
                <>
                  <option value="">Select Package</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} - ₦{pkg.amount?.toLocaleString()}
                    </option>
                  ))}
                </>
              )}
            </select>
            {packages.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">
                ⚠️ No Collection packages found. Please create a Collection package under <strong>Package &gt; Collection</strong> first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
Package Amount *
            </label>
            <input
              type="number"
              name="packageAmount"
              value={formData.packageAmount}
              readOnly
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cycle
            </label>
            <input
              type="number"
              name="cycle"
              value={formData.cycle}
              readOnly
              min="1"
              max="365"
              className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              Total cycle length in days (default: 31)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cycle Counter
            </label>
            <input
              type="number"
              name="cycleCounter"
              value={formData.cycleCounter}
              readOnly
              min="1"
              max="365"
              className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              Current day in cycle (auto-assigned)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Due Date *
            </label>
            <input
              type="date"
              name="dueDate"
              value={formData.dueDate}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              required
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-orange-500 border border-transparent rounded-md hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
            >
              {loading ? 'Posting...' : 'Post Single Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SingleCollectionForm;
