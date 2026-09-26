"use client";

import React, { useState, useEffect } from 'react';
import { Eye, Calendar, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Swal from 'sweetalert2';
import { fetchJournalEntries } from '@/services/api';
import { getTransactionType } from '@/lib/utils';

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

export default function AnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<JournalEntry[]>([]);
  const [kpis, setKpis] = useState({
    totalRevenue: 0,
    totalExpenses: 0,
    netProfit: 0,
    totalTransactions: 0
  });

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const response = await fetchJournalEntries();
      // Sort by date descending, then by ID descending
      const sorted = (response.journalEntries || []).sort((a: JournalEntry, b: JournalEntry) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b.id - a.id;
      });
      setTransactions(sorted);
      
      // Calculate KPIs from transactions - parse as numbers to avoid NaN
      const totalDebits = sorted.reduce((sum: number, t: JournalEntry) => {
        return sum + (parseFloat(String(t.totalDebit)) || 0);
      }, 0);
      const totalCredits = sorted.reduce((sum: number, t: JournalEntry) => {
        return sum + (parseFloat(String(t.totalCredit)) || 0);
      }, 0);
      
      setKpis({
        totalRevenue: totalCredits,
        totalExpenses: totalDebits,
        netProfit: totalCredits - totalDebits,
        totalTransactions: sorted.length
      });
    } catch (error: any) {
      console.error('Failed to load transactions:', error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-yellow-100 text-yellow-800',
      posted: 'bg-green-100 text-green-800',
      reversed: 'bg-gray-100 text-gray-800'
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  const handleViewTransaction = (id: number) => {
    router.push(`/dashboard/accounting/analytics/${id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Transaction History</h1>
          <p className="text-gray-600 mt-1">View all accounting transactions in chronological order</p>
        </div>

        {/* KPI Cards */}
        {!loading && transactions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-600">Total Transactions</p>
                <FileText className="text-indigo-500" size={20} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{kpis.totalTransactions}</p>
              <p className="text-xs text-gray-500 mt-1">All journal entries</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-600">Total Debits</p>
                <div className="text-green-500">↑</div>
              </div>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(kpis.totalExpenses)}</p>
              <p className="text-xs text-gray-500 mt-1">Total debit entries</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-600">Total Credits</p>
                <div className="text-red-500">↓</div>
              </div>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(kpis.totalRevenue)}</p>
              <p className="text-xs text-gray-500 mt-1">Total credit entries</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-600">Net Balance</p>
                <div className={kpis.netProfit >= 0 ? "text-green-500" : "text-red-500"}>
                  {kpis.netProfit >= 0 ? "↑" : "↓"}
                </div>
              </div>
              <p className={`text-2xl font-bold ${kpis.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(Math.abs(kpis.netProfit))}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {kpis.netProfit >= 0 ? 'Credit surplus' : 'Debit surplus'}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="mt-2 text-gray-600">Loading transactions...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <div className="text-gray-400 mb-4">
              <FileText className="w-20 h-20 mx-auto" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Transactions Found</h3>
            <p className="text-gray-600 mb-6">
              No journal entries have been created yet.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto">
              <p className="text-sm text-blue-800 mb-4">
                <strong>💡 To create transactions:</strong>
              </p>
              <ol className="text-left text-sm text-blue-800 space-y-2">
                <li>1. Go to <a href="/dashboard/accounting/setup" className="text-indigo-600 hover:underline font-semibold">Setup & COA</a> to create accounts</li>
                <li>2. Go to <a href="/dashboard/accounting/journals" className="text-indigo-600 hover:underline font-semibold">Journals</a> to record journal entries</li>
                <li>3. Post your entries to make them official</li>
                <li>4. Return here to view all transactions</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-gray-400" />
                        {new Date(transaction.date).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">
                      {transaction.reference}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">
                        {getTransactionType(transaction.description)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {transaction.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                      {formatCurrency(transaction.totalDebit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-medium">
                      {formatCurrency(transaction.totalCredit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(transaction.status)}`}>
                        {transaction.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <button
                        onClick={() => handleViewTransaction(transaction.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
                        title="View Details"
                      >
                        <Eye size={16} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary */}
            <div className="bg-gray-50 px-6 py-4 border-t">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  Total Transactions: <span className="font-semibold text-gray-900">{transactions.length}</span>
                </p>
                <div className="flex gap-8">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Debits</p>
                    <p className="text-lg font-bold text-green-600">
                      {formatCurrency(transactions.reduce((sum: number, t: JournalEntry) => {
                        return sum + (parseFloat(String(t.totalDebit)) || 0);
                      }, 0))}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Credits</p>
                    <p className="text-lg font-bold text-red-600">
                      {formatCurrency(transactions.reduce((sum: number, t: JournalEntry) => {
                        return sum + (parseFloat(String(t.totalCredit)) || 0);
                      }, 0))}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
