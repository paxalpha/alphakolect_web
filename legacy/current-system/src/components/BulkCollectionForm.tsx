"use client";
import React, { useState, useEffect } from 'react';
import { FaTimes, FaPlus, FaTrash } from 'react-icons/fa';
import { fetchCustomers, fetchPackages, createCollection } from '@/services/api';
import Swal from 'sweetalert2';

interface BulkCollectionFormProps {
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

interface CollectionRow {
  id: string;
  selectedCustomerId: string;
  customerName: string;
  selectedPackageId: string;
  packageName: string;
  packageAmount: string;
  cycle: number;
  cycleCounter: number;
  dueDate: string;
}

const BulkCollectionForm: React.FC<BulkCollectionFormProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);

  const createDefaultRow = (): CollectionRow => ({
    id: Math.random().toString(36).substring(2, 9),
    selectedCustomerId: '',
    customerName: '',
    selectedPackageId: '',
    packageName: '',
    packageAmount: '',
    cycle: 31,
    cycleCounter: 1,
    dueDate: new Date().toISOString().split('T')[0]
  });

  const [rows, setRows] = useState<CollectionRow[]>([createDefaultRow()]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      setRows([createDefaultRow()]);
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
      console.error('Failed to fetch bulk collection form data:', error);
    }
  };

  const handleCustomerChange = (rowId: string, custId: string) => {
    setRows(prevRows =>
      prevRows.map(row => {
        if (row.id !== rowId) return row;

        if (!custId) {
          return {
            ...row,
            selectedCustomerId: '',
            customerName: '',
            selectedPackageId: '',
            packageName: '',
            packageAmount: ''
          };
        }

        const customer = customers.find(c => c.id.toString() === custId);
        if (!customer) return row;

        let assignedPkg = null;
        const pkgId = customer.packageId || (customer as any).package_id || (customer as any).PackageId || (customer as any).Package?.id;
        if (pkgId) {
          assignedPkg = packages.find(p => p.id.toString() === pkgId.toString());
        }
        if (!assignedPkg && customer.packageName && customer.packageName !== '—' && customer.packageName !== '-') {
          assignedPkg = packages.find(p => p.name.toLowerCase() === customer.packageName!.toLowerCase());
        }

        const selectedPkg = assignedPkg || (packages.length > 0 ? packages[0] : null);

        return {
          ...row,
          selectedCustomerId: customer.id.toString(),
          customerName: customer.fullName || (customer as any).name || '',
          selectedPackageId: selectedPkg ? selectedPkg.id.toString() : '',
          packageName: selectedPkg ? selectedPkg.name : '',
          packageAmount: selectedPkg ? selectedPkg.amount.toString() : ''
        };
      })
    );
  };

  const handlePackageChange = (rowId: string, pkgId: string) => {
    setRows(prevRows =>
      prevRows.map(row => {
        if (row.id !== rowId) return row;
        const selectedPackage = packages.find(pkg => pkg.id.toString() === pkgId);
        return {
          ...row,
          selectedPackageId: pkgId,
          packageName: selectedPackage?.name || '',
          packageAmount: selectedPackage ? selectedPackage.amount.toString() : row.packageAmount
        };
      })
    );
  };

  const handleFieldChange = (rowId: string, fieldName: keyof CollectionRow, value: any) => {
    setRows(prevRows =>
      prevRows.map(row => {
        if (row.id !== rowId) return row;
        return { ...row, [fieldName]: value };
      })
    );
  };

  const handleAddRow = () => {
    setRows(prev => [...prev, createDefaultRow()]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter(r => r.id !== rowId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate rows
    const invalidRow = rows.find(r => !r.selectedCustomerId || !r.packageName || !r.packageAmount);
    if (invalidRow) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please select a customer, package, and amount for all rows.'
      });
      return;
    }

    setLoading(true);
    try {
      let totalCreated = 0;
      for (const row of rows) {
        // The counter determines the number of collection transactions to create
        // per customer (e.g., counter 31 = 31 daily collections for the cycle).
        const count = Math.max(1, parseInt(row.cycleCounter.toString()) || 1);
        const baseDate = new Date(row.dueDate || new Date().toISOString().split('T')[0]);

        for (let i = 1; i <= count; i++) {
          const due = new Date(baseDate);
          due.setDate(due.getDate() + (i - 1));

          const collectionData = {
            customerName: row.customerName,
            amount: parseFloat(row.packageAmount),
            dueDate: due.toISOString().split('T')[0],
            type: 'Package Payment',
            packageName: row.packageName,
            packageAmount: parseFloat(row.packageAmount),
            cycle: parseInt(row.cycle.toString()) || 31,
            cycleCounter: i,
            isFirstCollection: i === 1
          };
          await createCollection(collectionData);
          totalCreated++;
        }
      }

      Swal.fire({
        icon: 'success',
        title: 'Success',
        text: `${totalCreated} collection(s) posted successfully!`
      });

      onSuccess();
      onClose();
    } catch (error: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to post bulk collection'
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            Bulk Collection
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <FaTimes size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="flex-1 min-w-[150px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Customer *
                  </label>
                  <select
                    value={row.selectedCustomerId}
                    onChange={(e) => handleCustomerChange(row.id, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
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

                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Package *
                  </label>
                  <select
                    value={row.selectedPackageId}
                    onChange={(e) => handlePackageChange(row.id, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    required
                  >
                    {packages.length === 0 ? (
                      <option value="">No Collection package</option>
                    ) : (
                      <>
                        <option value="">Select Package</option>
                        {packages.map((pkg) => (
                          <option key={pkg.id} value={pkg.id}>
                            {pkg.name}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                <div className="w-full md:w-28">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Amount *
                  </label>
                  <input
                    type="number"
                    value={row.packageAmount}
                    readOnly
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed text-sm"
                    required
                  />
                </div>

                <div className="w-full md:w-20">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Cycle
                  </label>
                  <input
                    type="number"
                    value={row.cycle}
                    readOnly
                    min="1"
                    max="365"
                    className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed text-sm text-center"
                  />
                </div>

                <div className="w-full md:w-20">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Counter (No.)
                  </label>
                  <input
                    type="number"
                    value={row.cycleCounter}
                    readOnly
                    min="1"
                    max="365"
                    className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed text-sm text-center"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5 text-center">No. of collections per customer</p>
                </div>

                <div className="w-full md:w-36">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Due Date *
                  </label>
                  <input
                    type="date"
                    value={row.dueDate}
                    onChange={(e) => handleFieldChange(row.id, 'dueDate', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    required
                  />
                </div>

                {rows.length > 1 && (
                  <div className="flex items-end pb-1 justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                      title="Remove Row"
                    >
                      <FaTrash size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleAddRow}
              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-semibold text-sm cursor-pointer"
            >
              <FaPlus size={14} />
              + Add another customer
            </button>
          </div>

          <div className="flex justify-end space-x-3 pt-6 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save All'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BulkCollectionForm;
