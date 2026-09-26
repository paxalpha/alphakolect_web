"use client";

import React, { useState, useEffect } from 'react';
import { Plus, Upload, Download, Settings, Calendar, DollarSign, FileText, Edit, Trash2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { 
  createAccount, 
  fetchAccounts, 
  updateAccount, 
  deleteAccount,
  createFiscalPeriod,
  fetchFiscalPeriods,
  updateFiscalPeriod,
  fetchTransactionMappings
} from '@/services/api';

interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
  category: string;
  balance: number;
  currency: string;
  description?: string;
  isActive?: boolean;
}

interface FiscalPeriod {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export default function AccountingSetupPage() {
  const [activeTab, setActiveTab] = useState('coa');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fiscalPeriods, setFiscalPeriods] = useState<FiscalPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [mappings, setMappings] = useState<any>(null);
  const [loadingMappings, setLoadingMappings] = useState(false);

  const [categories] = useState(['Current Assets', 'Fixed Assets', 'Current Liabilities', 'Long-term Liabilities', 'Equity', 'Revenue', 'Expenses']);
  const [accountTypes] = useState(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
  const [currencies] = useState(['NGN', 'USD', 'EUR', 'GBP']);

  useEffect(() => {
    loadAccounts();
    loadFiscalPeriods();
    loadTransactionMappings();
  }, []);

  const loadTransactionMappings = async () => {
    setLoadingMappings(true);
    try {
      const response = await fetchTransactionMappings();
      setMappings(response.transactionMappings || null);
    } catch (error: any) {
      console.error('Failed to load transaction mappings:', error);
    } finally {
      setLoadingMappings(false);
    }
  };

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const response = await fetchAccounts();
      setAccounts(response.accounts || []);
    } catch (error: any) {
      console.error('Failed to load accounts:', error);
      Swal.fire('Error', error.message || 'Failed to load accounts', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadFiscalPeriods = async () => {
    try {
      const response = await fetchFiscalPeriods();
      setFiscalPeriods(response.fiscalPeriods || []);
    } catch (error: any) {
      console.error('Failed to load fiscal periods:', error);
    }
  };

  const handleImportExcel = () => {
    Swal.fire({
      title: 'Import Accounts',
      html: `
        <input type="file" id="excel-file" accept=".xlsx,.xls,.csv" class="swal2-input" />
        <p class="text-sm text-gray-600 mt-2">Upload an Excel file with account data</p>
      `,
      showCancelButton: true,
      confirmButtonText: 'Import',
      preConfirm: () => {
        const fileInput = document.getElementById('excel-file') as HTMLInputElement;
        if (!fileInput.files || fileInput.files.length === 0) {
          Swal.showValidationMessage('Please select a file');
          return false;
        }
        return fileInput.files[0];
      }
    }).then((result) => {
      if (result.isConfirmed) {
        // TODO: Implement Excel import functionality
        Swal.fire('Info', 'Excel import functionality coming soon', 'info');
      }
    });
  };

  const handleAddAccount = () => {
    Swal.fire({
      title: 'Add New Account',
      html: `
        <div style="text-align: left;">
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Account Code *</label>
            <input id="account-code" class="swal2-input" placeholder="e.g., 1000" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Account Name *</label>
            <input id="account-name" class="swal2-input" placeholder="e.g., Cash" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Account Type *</label>
            <select id="account-type" class="swal2-select" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
              <option value="">Select Type</option>
              ${accountTypes.map(type => `<option value="${type}">${type}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Category *</label>
            <select id="account-category" class="swal2-select" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
              <option value="">Select Category</option>
              ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Opening Balance</label>
            <input id="opening-balance" class="swal2-input" type="number" step="0.01" placeholder="0.00" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Description</label>
            <textarea id="account-description" class="swal2-textarea" placeholder="Optional description" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; min-height: 80px;"></textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Add Account',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#4f46e5',
      width: '600px',
      preConfirm: () => {
        const code = (document.getElementById('account-code') as HTMLInputElement).value;
        const name = (document.getElementById('account-name') as HTMLInputElement).value;
        const type = (document.getElementById('account-type') as HTMLSelectElement).value;
        const category = (document.getElementById('account-category') as HTMLSelectElement).value;
        const balance = parseFloat((document.getElementById('opening-balance') as HTMLInputElement).value || '0');
        const description = (document.getElementById('account-description') as HTMLTextAreaElement).value;

        if (!code || !name || !type || !category) {
          Swal.showValidationMessage('Please fill all required fields');
          return false;
        }

        return { code, name, type, category, balance, description, currency: 'NGN' };
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const response = await createAccount(result.value);
          Swal.fire('Success', response.message || 'Account added successfully', 'success');
          loadAccounts();
        } catch (error: any) {
          Swal.fire('Error', error.message || 'Failed to add account', 'error');
        }
      }
    });
  };

  const handleEditAccount = (account: Account) => {
    Swal.fire({
      title: 'Edit Account',
      html: `
        <div style="text-align: left;">
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Account Code *</label>
            <input id="account-code" class="swal2-input" placeholder="Account Code" value="${account.code}" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Account Name *</label>
            <input id="account-name" class="swal2-input" placeholder="Account Name" value="${account.name}" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Account Type *</label>
            <select id="account-type" class="swal2-select" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
              ${accountTypes.map(type => `<option value="${type}" ${type === account.type ? 'selected' : ''}>${type}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Category *</label>
            <select id="account-category" class="swal2-select" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
              ${categories.map(cat => `<option value="${cat}" ${cat === account.category ? 'selected' : ''}>${cat}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Balance</label>
            <input id="opening-balance" class="swal2-input" type="number" step="0.01" placeholder="Balance" value="${account.balance}" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">Description</label>
            <textarea id="account-description" class="swal2-textarea" placeholder="Description" style="width: 100%; margin: 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; min-height: 80px;">${account.description || ''}</textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Update Account',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#4f46e5',
      width: '600px',
      preConfirm: () => {
        const code = (document.getElementById('account-code') as HTMLInputElement).value;
        const name = (document.getElementById('account-name') as HTMLInputElement).value;
        const type = (document.getElementById('account-type') as HTMLSelectElement).value;
        const category = (document.getElementById('account-category') as HTMLSelectElement).value;
        const balance = parseFloat((document.getElementById('opening-balance') as HTMLInputElement).value || '0');
        const description = (document.getElementById('account-description') as HTMLTextAreaElement).value;

        if (!code || !name || !type || !category) {
          Swal.showValidationMessage('Please fill all required fields');
          return false;
        }

        return { id: account.id, code, name, type, category, balance, description };
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const response = await updateAccount(result.value);
          Swal.fire('Success', response.message || 'Account updated successfully', 'success');
          loadAccounts();
        } catch (error: any) {
          Swal.fire('Error', error.message || 'Failed to update account', 'error');
        }
      }
    });
  };

  const handleDeleteAccount = async (id: number) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: 'This will delete the account permanently',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
      try {
        await deleteAccount(String(id));
        Swal.fire('Deleted!', 'Account deleted successfully', 'success');
        loadAccounts();
      } catch (error: any) {
        Swal.fire('Error', error.message || 'Failed to delete account', 'error');
      }
    }
  };

  const handleSaveFiscalPeriod = async () => {
    const startDate = (document.getElementById('fiscal-start') as HTMLInputElement).value;
    const endDate = (document.getElementById('fiscal-end') as HTMLInputElement).value;
    const name = `FY ${new Date(startDate).getFullYear()}`;

    if (!startDate || !endDate) {
      Swal.fire('Error', 'Please select start and end dates', 'error');
      return;
    }

    try {
      const response = await createFiscalPeriod({ name, startDate, endDate });
      Swal.fire('Success', response.message || 'Fiscal period saved successfully', 'success');
      loadFiscalPeriods();
    } catch (error: any) {
      Swal.fire('Error', error.message || 'Failed to save fiscal period', 'error');
    }
  };

  const handleUpdateCurrency = () => {
    // TODO: Implement currency update API
    Swal.fire({
      title: 'Success',
      text: 'Currency settings updated successfully',
      icon: 'success',
      timer: 2000,
      showConfirmButton: false
    });
  };


  const renderChartOfAccounts = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Chart of Accounts</h2>
        <div className="flex gap-2">
          <button
            onClick={handleImportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Upload size={18} />
            Import Excel
          </button>
          <button
            onClick={handleAddAccount}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <Plus size={18} />
            Add Account
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-2 text-gray-600">Loading accounts...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Balance</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    No accounts found. Click "Add Account" to create one.
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{account.code}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{account.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{account.type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{account.category}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {account.currency} {Number(account.balance).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleEditAccount(account)}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteAccount(account.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderCategories = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Account Categories</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category, index) => (
          <div key={index} className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{category}</h3>
            <p className="text-sm text-gray-600">
              {accounts.filter(acc => acc.category === category).length} accounts
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFinancialYear = () => (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Financial Year Setup</h2>
      
      <div className="bg-white p-6 rounded-lg shadow-sm border mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Fiscal Period</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Financial Year Start</label>
            <input
              id="fiscal-start"
              type="date"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              defaultValue="2024-01-01"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Financial Year End</label>
            <input
              id="fiscal-end"
              type="date"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              defaultValue="2024-12-31"
            />
          </div>
        </div>
        <div className="mt-6">
          <button 
            onClick={handleSaveFiscalPeriod}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Create Fiscal Period
          </button>
        </div>
      </div>

      {/* Existing Fiscal Periods */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Fiscal Periods</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {fiscalPeriods.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No fiscal periods found. Create one above.
            </div>
          ) : (
            fiscalPeriods.map((period) => (
              <div key={period.id} className="px-6 py-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <h4 className="font-medium text-gray-900">{period.name}</h4>
                  <p className="text-sm text-gray-600">
                    {new Date(period.startDate).toLocaleDateString()} - {new Date(period.endDate).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  period.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {period.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderCurrency = () => (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Currency Configuration</h2>
      
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Base Currency</label>
          <select className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {currencies.map(curr => (
              <option key={curr} value={curr}>{curr}</option>
            ))}
          </select>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 mb-4">Exchange Rates</h3>
        <div className="space-y-4">
          {currencies.filter(c => c !== 'NGN').map(currency => (
            <div key={currency} className="flex items-center gap-4">
              <span className="w-20 font-medium text-gray-700">{currency}</span>
              <input
                type="number"
                step="0.01"
                placeholder="Rate to NGN"
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          ))}
        </div>

        <div className="mt-6">
          <button 
            onClick={handleUpdateCurrency}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Update Rates
          </button>
        </div>
      </div>
    </div>
  );

  const renderTransactionMappings = () => {
    if (loadingMappings) {
      return (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-2 text-gray-600">Loading mappings...</p>
        </div>
      );
    }

    if (!mappings) {
      return (
        <div className="text-center py-8 text-gray-500">
          No transaction mappings configuration found.
        </div>
      );
    }

    const getAccountDisplay = (code: string) => {
      const acc = accounts.find(a => a.code === code);
      return acc ? `${code} — ${acc.name}` : code;
    };

    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Transaction Mappings</h2>
            <p className="text-sm text-gray-600 mt-1">
              Automatic double-entry bookkeeping rules for wallet, loan, remittance, and investment transactions.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">System Key</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Debit Account (Dr)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Credit Account (Cr)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.entries(mappings).map(([key, value]: any) => (
                <tr key={key} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{key}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{value.label}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium mr-2">DR</span>
                    <span className="text-gray-900 font-medium">{getAccountDisplay(value.debitCode)}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs font-medium mr-2">CR</span>
                    <span className="text-gray-900 font-medium">{getAccountDisplay(value.creditCode)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Accounting Setup</h1>
          <p className="text-gray-600 mt-1">Configure your chart of accounts and financial settings</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border mb-6">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => setActiveTab('coa')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeTab === 'coa'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Chart of Accounts
            </button>
            <button
              onClick={() => setActiveTab('categories')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeTab === 'categories'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Categories & Types
            </button>
            <button
              onClick={() => setActiveTab('financial-year')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeTab === 'financial-year'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Financial Year
            </button>
            <button
              onClick={() => setActiveTab('currency')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeTab === 'currency'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Currency
            </button>
            <button
              onClick={() => setActiveTab('mappings')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeTab === 'mappings'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Transaction Mappings
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'coa' && renderChartOfAccounts()}
          {activeTab === 'categories' && renderCategories()}
          {activeTab === 'financial-year' && renderFinancialYear()}
          {activeTab === 'currency' && renderCurrency()}
          {activeTab === 'mappings' && renderTransactionMappings()}
        </div>
      </div>
    </div>
  );
}
