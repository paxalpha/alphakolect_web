"use client";

import React, { useState, useEffect } from 'react';
import { Plus, Upload, FileText, Edit, Trash2, Check, RotateCcw } from 'lucide-react';
import Swal from 'sweetalert2';
import { 
  createJournalEntry, 
  fetchJournalEntries, 
  postJournalEntry,
  reverseJournalEntry,
  deleteJournalEntry,
  fetchAccounts
} from '@/services/api';
import { getTransactionType } from '@/lib/utils';

interface JournalLine {
  accountId: string;
  accountName?: string;
  debit: number;
  credit: number;
  description: string;
}

interface JournalEntry {
  id: number;
  reference: string;
  date: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  status: string;
  lines?: any[];
}

interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
}

export default function JournalsPage() {
  const [activeTab, setActiveTab] = useState('list');
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);

  // Create entry form state
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryDescription, setEntryDescription] = useState('');
  const [journalLines, setJournalLines] = useState<JournalLine[]>([
    { accountId: '', debit: 0, credit: 0, description: '' },
    { accountId: '', debit: 0, credit: 0, description: '' }
  ]);

  // Filter and search state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    loadJournalEntries();
    loadAccounts();
  }, []);

  const loadJournalEntries = async () => {
    setLoading(true);
    try {
      const response = await fetchJournalEntries();
      setJournalEntries(response.journalEntries || []);
    } catch (error: any) {
      console.error('Failed to load journal entries:', error);
      Swal.fire('Error', error.message || 'Failed to load journal entries', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await fetchAccounts();
      setAccounts(response.accounts || []);
    } catch (error: any) {
      console.error('Failed to load accounts:', error);
    }
  };

  const addJournalLine = () => {
    setJournalLines([...journalLines, { accountId: '', debit: 0, credit: 0, description: '' }]);
  };

  const removeJournalLine = (index: number) => {
    if (journalLines.length > 1) {
      setJournalLines(journalLines.filter((_, i) => i !== index));
    }
  };

  const updateJournalLine = (index: number, field: keyof JournalLine, value: any) => {
    const updated = [...journalLines];
    updated[index] = { ...updated[index], [field]: value };
    setJournalLines(updated);
  };

  const calculateTotals = () => {
    const totalDebit = journalLines.reduce((sum, line) => sum + parseFloat(String(line.debit || 0)), 0);
    const totalCredit = journalLines.reduce((sum, line) => sum + parseFloat(String(line.credit || 0)), 0);
    return { totalDebit, totalCredit, difference: totalDebit - totalCredit };
  };

  const handleCreateEntry = async () => {
    const { totalDebit, totalCredit, difference } = calculateTotals();

    if (Math.abs(difference) > 0.01) {
      Swal.fire('Error', `Entry is not balanced. Difference: ${difference.toFixed(2)}`, 'error');
      return;
    }

    if (!entryDescription) {
      Swal.fire('Error', 'Please enter a description', 'error');
      return;
    }

    if (journalLines.some(line => !line.accountId)) {
      Swal.fire('Error', 'Please select an account for all lines', 'error');
      return;
    }

    try {
      const response = await createJournalEntry({
        date: entryDate,
        description: entryDescription,
        lines: journalLines.map(line => ({
          accountId: parseInt(line.accountId),
          debit: parseFloat(String(line.debit || 0)),
          credit: parseFloat(String(line.credit || 0)),
          description: line.description
        }))
      });

      Swal.fire('Success', response.message || 'Journal entry created successfully', 'success');
      loadJournalEntries();
      setActiveTab('list');
      
      // Reset form
      setEntryDate(new Date().toISOString().split('T')[0]);
      setEntryDescription('');
      setJournalLines([
        { accountId: '', debit: 0, credit: 0, description: '' },
        { accountId: '', debit: 0, credit: 0, description: '' }
      ]);
    } catch (error: any) {
      Swal.fire('Error', error.message || 'Failed to create journal entry', 'error');
    }
  };

  const handlePostEntry = async (id: number) => {
    const result = await Swal.fire({
      title: 'Post Entry?',
      text: 'Posted entries cannot be edited',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, post it!'
    });

    if (result.isConfirmed) {
      try {
        await postJournalEntry(String(id));
        Swal.fire('Posted!', 'Entry posted successfully', 'success');
        loadJournalEntries();
      } catch (error: any) {
        Swal.fire('Error', error.message || 'Failed to post entry', 'error');
      }
    }
  };

  const handleReverseEntry = async (id: number) => {
    const result = await Swal.fire({
      title: 'Reverse Entry?',
      text: 'This will create a reversing entry',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, reverse it!'
    });

    if (result.isConfirmed) {
      try {
        await reverseJournalEntry(String(id));
        Swal.fire('Reversed!', 'Entry reversed successfully', 'success');
        loadJournalEntries();
      } catch (error: any) {
        Swal.fire('Error', error.message || 'Failed to reverse entry', 'error');
      }
    }
  };

  const handleDeleteEntry = async (id: number) => {
    const result = await Swal.fire({
      title: 'Delete Entry?',
      text: 'This action cannot be undone',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
      try {
        await deleteJournalEntry(String(id));
        Swal.fire('Deleted!', 'Entry deleted successfully', 'success');
        loadJournalEntries();
      } catch (error: any) {
        Swal.fire('Error', error.message || 'Failed to delete entry', 'error');
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-yellow-100 text-yellow-800',
      posted: 'bg-green-100 text-green-800',
      reversed: 'bg-gray-100 text-gray-800'
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  const formatCurrency = (amount: number) => `₦${Number(amount).toLocaleString()}`;

  // Filter journal entries
  const filteredEntries = journalEntries.filter(entry => {
    const matchesSearch = 
      entry.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || entry.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });


  const renderListView = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Journal Entries</h2>
        <button
          onClick={() => setActiveTab('create')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <Plus size={18} />
          Create Entry
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by reference or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
            </select>
          </div>
          {(searchTerm || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-2 text-gray-600">Loading journal entries...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                    {journalEntries.length === 0 
                      ? "No journal entries found. Click \"Create Entry\" to add one."
                      : "No entries match your search criteria."}
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">
                      {entry.reference}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{entry.description}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">
                        {getTransactionType(entry.description)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                      {formatCurrency(entry.totalDebit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-medium">
                      {formatCurrency(entry.totalCredit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(entry.status)}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        {entry.status === 'draft' && (
                          <>
                            <button
                              onClick={() => handlePostEntry(entry.id)}
                              className="text-green-600 hover:text-green-900"
                              title="Post"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteEntry(entry.id)}
                              className="text-red-600 hover:text-red-900"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                        {entry.status === 'posted' && (
                          <button
                            onClick={() => handleReverseEntry(entry.id)}
                            className="text-orange-600 hover:text-orange-900"
                            title="Reverse"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
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

  const renderCreateView = () => {
    const { totalDebit, totalCredit, difference } = calculateTotals();

    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Create Journal Entry</h2>
          <button
            onClick={() => setActiveTab('list')}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Back to List
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <input
                type="text"
                value={entryDescription}
                onChange={(e) => setEntryDescription(e.target.value)}
                placeholder="Entry description"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <h3 className="text-lg font-semibold text-gray-900 mb-2">Journal Lines</h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-blue-800">
              💡 <strong>Double-Entry Accounting:</strong> Total debits must equal total credits. 
              Enter debits in one line and credits in another to balance the entry.
            </p>
          </div>
          
          <div className="space-y-4 mb-6">
            {journalLines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 gap-4 items-end">
                <div className="col-span-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Account</label>
                  <select
                    value={line.accountId}
                    onChange={(e) => updateJournalLine(index, 'accountId', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select Account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} - {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Debit</label>
                  <input
                    type="number"
                    step="0.01"
                    value={line.debit || ''}
                    onChange={(e) => updateJournalLine(index, 'debit', parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Credit</label>
                  <input
                    type="number"
                    step="0.01"
                    value={line.credit || ''}
                    onChange={(e) => updateJournalLine(index, 'credit', parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateJournalLine(index, 'description', e.target.value)}
                    placeholder="Line description"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="col-span-1">
                  <button
                    onClick={() => removeJournalLine(index)}
                    disabled={journalLines.length === 1}
                    className="w-full px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={16} className="mx-auto" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addJournalLine}
            className="mb-6 flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Plus size={16} />
            Add Line
          </button>

          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-sm text-gray-600">Total Debit</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(totalDebit)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Credit</p>
                <p className="text-xl font-bold text-red-600">{formatCurrency(totalCredit)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Difference</p>
                <p className={`text-xl font-bold ${Math.abs(difference) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(Math.abs(difference))}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleCreateEntry}
              disabled={Math.abs(difference) > 0.01}
              className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
                Math.abs(difference) > 0.01
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg cursor-pointer'
              }`}
              title={Math.abs(difference) > 0.01 ? 'Entry must be balanced (Debits = Credits)' : 'Create journal entry'}
            >
              {Math.abs(difference) > 0.01 ? '⚠️ Entry Not Balanced' : '✓ Create Journal Entry'}
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Journals & Transactions</h1>
          <p className="text-gray-600 mt-1">Record and manage journal entries</p>
        </div>

        {activeTab === 'list' && renderListView()}
        {activeTab === 'create' && renderCreateView()}
      </div>
    </div>
  );
}
