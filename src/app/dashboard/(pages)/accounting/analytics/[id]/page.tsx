"use client";

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, FileText, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import Swal from 'sweetalert2';
import { fetchJournalEntries } from '@/services/api';
import { getTransactionType } from '@/lib/utils';

interface JournalLine {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  description: string;
  Account?: {
    id: number;
    code: string;
    name: string;
    type: string;
  };
}

interface JournalEntry {
  id: number;
  reference: string;
  date: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  lines?: JournalLine[];
}

export default function TransactionDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const transactionId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [transaction, setTransaction] = useState<JournalEntry | null>(null);

  useEffect(() => {
    if (transactionId) {
      loadTransactionDetails();
    }
  }, [transactionId]);

  const loadTransactionDetails = async () => {
    setLoading(true);
    try {
      const response = await fetchJournalEntries();
      const found = response.journalEntries?.find((entry: JournalEntry) => entry.id === parseInt(transactionId));
      
      if (found) {
        setTransaction(found);
      } else {
        Swal.fire('Error', 'Transaction not found', 'error');
        router.push('/dashboard/accounting/analytics');
      }
    } catch (error: any) {
      console.error('Failed to load transaction:', error);
      Swal.fire('Error', 'Failed to load transaction details', 'error');
      router.push('/dashboard/accounting/analytics');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'posted':
        return <CheckCircle className="text-green-600" size={24} />;
      case 'reversed':
        return <XCircle className="text-gray-600" size={24} />;
      case 'draft':
      default:
        return <Clock className="text-yellow-600" size={24} />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      posted: 'bg-green-100 text-green-800 border-green-300',
      reversed: 'bg-gray-100 text-gray-800 border-gray-300'
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="mt-2 text-gray-600">Loading transaction details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/dashboard/accounting/analytics')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            Back to Transactions
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Transaction Details</h1>
              <p className="text-gray-600 mt-1">Reference: {transaction.reference}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-semibold">
                {getTransactionType(transaction.description)}
              </span>
              {getStatusIcon(transaction.status)}
              <span className={`px-4 py-2 text-sm font-semibold rounded-lg border-2 ${getStatusBadge(transaction.status)}`}>
                {transaction.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Transaction Info Card */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Transaction Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-600 mb-1">Reference Number</p>
              <p className="text-lg font-semibold text-indigo-600">{transaction.reference}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Transaction Date</p>
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                <p className="text-lg font-semibold text-gray-900">
                  {new Date(transaction.date).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Created On</p>
              <p className="text-lg font-semibold text-gray-900">
                {new Date(transaction.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Last Updated</p>
              <p className="text-lg font-semibold text-gray-900">
                {new Date(transaction.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t">
            <p className="text-sm text-gray-600 mb-2">Description</p>
            <p className="text-base text-gray-900">{transaction.description}</p>
          </div>
        </div>

        {/* Journal Lines */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="text-xl font-bold text-gray-900">Journal Lines</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {transaction.lines && transaction.lines.length > 0 ? (
                transaction.lines.map((line, index) => (
                  <tr key={line.id || index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {line.Account?.code || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {line.Account?.name || 'Unknown Account'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {line.Account?.type || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {line.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                      {line.debit > 0 ? (
                        <span className="text-green-600">{formatCurrency(line.debit)}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                      {line.credit > 0 ? (
                        <span className="text-red-600">{formatCurrency(line.credit)}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    No journal lines found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Transaction Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700 mb-1">Total Debits</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(transaction.totalDebit)}
              </p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-700 mb-1">Total Credits</p>
              <p className="text-2xl font-bold text-red-600">
                {formatCurrency(transaction.totalCredit)}
              </p>
            </div>
            <div className={`border-2 rounded-lg p-4 ${
              Math.abs(transaction.totalDebit - transaction.totalCredit) < 0.01
                ? 'bg-indigo-50 border-indigo-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              <p className={`text-sm mb-1 ${
                Math.abs(transaction.totalDebit - transaction.totalCredit) < 0.01
                  ? 'text-indigo-700'
                  : 'text-yellow-700'
              }`}>
                Balance Status
              </p>
              <p className={`text-2xl font-bold ${
                Math.abs(transaction.totalDebit - transaction.totalCredit) < 0.01
                  ? 'text-indigo-600'
                  : 'text-yellow-600'
              }`}>
                {Math.abs(transaction.totalDebit - transaction.totalCredit) < 0.01
                  ? '✓ Balanced'
                  : '⚠ Unbalanced'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
