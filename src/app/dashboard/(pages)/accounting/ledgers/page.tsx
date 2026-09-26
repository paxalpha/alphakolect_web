"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, Download, Filter } from 'lucide-react';
import Swal from 'sweetalert2';
import { fetchAccounts, fetchGeneralLedger } from '@/services/api';
import { getTransactionType } from '@/lib/utils';

interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
  balance: number;
}

interface LedgerEntry {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export default function LedgersPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [accountInfo, setAccountInfo] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);

  const [dateFrom, setDateFrom] = useState('2024-01-01');
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      loadLedger();
    }
  }, [selectedAccount, dateFrom, dateTo]);

  const loadAccounts = async () => {
    try {
      const response = await fetchAccounts();
      setAccounts(response.accounts || []);
      if (response.accounts && response.accounts.length > 0) {
        setSelectedAccount(String(response.accounts[0].id));
      }
    } catch (error: any) {
      console.error('Failed to load accounts:', error);
      Swal.fire('Error', error.message || 'Failed to load accounts', 'error');
    }
  };

  const loadLedger = async () => {
    if (!selectedAccount) return;

    setLoading(true);
    try {
      const response = await fetchGeneralLedger({
        accountId: selectedAccount,
        dateFrom,
        dateTo
      });
      setLedgerEntries(response.ledgerEntries || []);
      setAccountInfo(response.account);
    } catch (error: any) {
      console.error('Failed to load ledger:', error);
      Swal.fire('Error', error.message || 'Failed to load ledger', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportToCSV = () => {
    if (ledgerEntries.length === 0) {
      Swal.fire('Info', 'No data to export', 'info');
      return;
    }

    const headers = ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];
    const rows = ledgerEntries.map(entry => [
      new Date(entry.date).toLocaleDateString(),
      entry.reference,
      entry.description,
      entry.debit,
      entry.credit,
      entry.balance
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger_${accountInfo?.code}_${dateFrom}_${dateTo}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    Swal.fire('Success', 'Ledger exported successfully', 'success');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">General Ledger</h1>
          <p className="text-gray-600 mt-1">View detailed account transactions and running balances</p>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar - Account Selection */}
          <div className="col-span-3">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Account</h2>
              
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => setSelectedAccount(String(account.id))}
                    className={`w-full text-left px-4 py-3 rounded-lg transition ${
                      selectedAccount === String(account.id)
                        ? 'bg-indigo-50 border-2 border-indigo-600'
                        : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-medium text-gray-900">{account.code}</div>
                    <div className="text-sm text-gray-600">{account.name}</div>
                    <div className="text-sm font-semibold text-indigo-600 mt-1">
                      {formatCurrency(account.balance)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content - Ledger */}
          <div className="col-span-9">
            {/* Filters */}
            <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="pt-7">
                  <button
                    onClick={loadLedger}
                    className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    <Filter size={18} />
                    Apply Filter
                  </button>
                </div>
                <div className="pt-7">
                  <button
                    onClick={exportToCSV}
                    className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    <Download size={18} />
                    Export
                  </button>
                </div>
              </div>
            </div>

            {/* Account Info */}
            {accountInfo && (
              <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
                <div className="grid grid-cols-4 gap-6">
                  <div>
                    <p className="text-sm text-gray-600">Account Code</p>
                    <p className="text-lg font-semibold text-gray-900">{accountInfo.code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Account Name</p>
                    <p className="text-lg font-semibold text-gray-900">{accountInfo.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Account Type</p>
                    <p className="text-lg font-semibold text-gray-900">{accountInfo.type}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Current Balance</p>
                    <p className="text-lg font-semibold text-indigo-600">{formatCurrency(accountInfo.balance)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Ledger Table */}
            {loading ? (
              <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <p className="mt-2 text-gray-600">Loading ledger...</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {ledgerEntries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                          No transactions found for this account in the selected period.
                        </td>
                      </tr>
                    ) : (
                      ledgerEntries.map((entry, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {new Date(entry.date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">
                            {entry.reference}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">{entry.description}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">
                              {getTransactionType(entry.description)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                            {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-medium">
                            {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900">
                            {formatCurrency(entry.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary */}
            {ledgerEntries.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border p-6 mt-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Period Summary</h3>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-gray-600">Total Debits</p>
                    <p className="text-xl font-bold text-green-600">
                      {formatCurrency(ledgerEntries.reduce((sum, e) => sum + e.debit, 0))}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Credits</p>
                    <p className="text-xl font-bold text-red-600">
                      {formatCurrency(ledgerEntries.reduce((sum, e) => sum + e.credit, 0))}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Closing Balance</p>
                    <p className="text-xl font-bold text-indigo-600">
                      {formatCurrency(ledgerEntries[ledgerEntries.length - 1]?.balance || 0)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
