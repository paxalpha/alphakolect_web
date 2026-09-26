"use client";

import React, { useState, useEffect } from 'react';
import { Download, Calendar, FileText } from 'lucide-react';
import Swal from 'sweetalert2';
import { fetchTrialBalance, fetchBalanceSheet, fetchIncomeStatement } from '@/services/api';

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState('trial-balance');
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);

  const [dateFrom, setDateFrom] = useState('2024-01-01');
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadReport();
  }, [activeReport]);

  const loadReport = async () => {
    setLoading(true);
    try {
      let response;
      if (activeReport === 'trial-balance') {
        response = await fetchTrialBalance({ asOfDate: dateTo });
        setReportData(response);
      } else if (activeReport === 'balance-sheet') {
        response = await fetchBalanceSheet({ asOfDate: dateTo });
        setReportData(response.balanceSheet);
      } else if (activeReport === 'profit-loss') {
        response = await fetchIncomeStatement({ dateFrom, dateTo });
        setReportData(response.incomeStatement);
      }
    } catch (error: any) {
      console.error('Failed to load report:', error);
      Swal.fire('Error', error.message || 'Failed to load report', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportToPDF = () => {
    Swal.fire('Info', 'PDF export functionality coming soon', 'info');
  };

  const renderTrialBalance = () => {
    if (!reportData) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b">
          <h2 className="text-xl font-bold text-gray-900">Trial Balance</h2>
          <p className="text-sm text-gray-600">As of {new Date(dateTo).toLocaleDateString()}</p>
        </div>

        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reportData.trialBalance?.map((item: any, index: number) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.code}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{item.type}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                  {item.debit > 0 ? formatCurrency(item.debit) : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-medium">
                  {item.credit > 0 ? formatCurrency(item.credit) : '-'}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-100 font-bold">
              <td colSpan={3} className="px-6 py-4 text-right text-gray-900">Total</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600">
                {formatCurrency(reportData.totalDebit || 0)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                {formatCurrency(reportData.totalCredit || 0)}
              </td>
            </tr>
            {Math.abs(reportData.difference || 0) > 0.01 && (
              <tr className="bg-red-50">
                <td colSpan={3} className="px-6 py-4 text-right text-red-900 font-semibold">Difference</td>
                <td colSpan={2} className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-bold">
                  {formatCurrency(Math.abs(reportData.difference || 0))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderBalanceSheet = () => {
    if (!reportData) return null;

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Balance Sheet</h2>
          <p className="text-sm text-gray-600 mb-6">As of {new Date(dateTo).toLocaleDateString()}</p>

          {/* Assets */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">ASSETS</h3>
            
            <div className="mb-4">
              <h4 className="font-medium text-gray-700 mb-2">Current Assets</h4>
              {reportData.assets?.current?.map((item: any, index: number) => (
                <div key={index} className="flex justify-between py-1 pl-4">
                  <span className="text-gray-600">{item.name}</span>
                  <span className="font-medium">{formatCurrency(item.balance)}</span>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <h4 className="font-medium text-gray-700 mb-2">Fixed Assets</h4>
              {reportData.assets?.fixed?.map((item: any, index: number) => (
                <div key={index} className="flex justify-between py-1 pl-4">
                  <span className="text-gray-600">{item.name}</span>
                  <span className="font-medium">{formatCurrency(item.balance)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-between py-2 border-t font-bold">
              <span>Total Assets</span>
              <span className="text-indigo-600">{formatCurrency(reportData.assets?.total || 0)}</span>
            </div>
          </div>

          {/* Liabilities */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">LIABILITIES</h3>
            
            <div className="mb-4">
              <h4 className="font-medium text-gray-700 mb-2">Current Liabilities</h4>
              {reportData.liabilities?.current?.map((item: any, index: number) => (
                <div key={index} className="flex justify-between py-1 pl-4">
                  <span className="text-gray-600">{item.name}</span>
                  <span className="font-medium">{formatCurrency(item.balance)}</span>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <h4 className="font-medium text-gray-700 mb-2">Long-term Liabilities</h4>
              {reportData.liabilities?.longTerm?.map((item: any, index: number) => (
                <div key={index} className="flex justify-between py-1 pl-4">
                  <span className="text-gray-600">{item.name}</span>
                  <span className="font-medium">{formatCurrency(item.balance)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-between py-2 border-t font-bold">
              <span>Total Liabilities</span>
              <span className="text-indigo-600">{formatCurrency(reportData.liabilities?.total || 0)}</span>
            </div>
          </div>

          {/* Equity */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">EQUITY</h3>
            {reportData.equity?.items?.map((item: any, index: number) => (
              <div key={index} className="flex justify-between py-1 pl-4">
                <span className="text-gray-600">{item.name}</span>
                <span className="font-medium">{formatCurrency(item.balance)}</span>
              </div>
            ))}

            <div className="flex justify-between py-2 border-t font-bold">
              <span>Total Equity</span>
              <span className="text-indigo-600">{formatCurrency(reportData.equity?.total || 0)}</span>
            </div>
          </div>

          {/* Total Liabilities & Equity */}
          <div className="flex justify-between py-3 border-t-2 border-gray-900 font-bold text-lg">
            <span>Total Liabilities & Equity</span>
            <span className="text-indigo-600">
              {formatCurrency((reportData.liabilities?.total || 0) + (reportData.equity?.total || 0))}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderProfitLoss = () => {
    if (!reportData) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Profit & Loss Statement</h2>
        <p className="text-sm text-gray-600 mb-6">
          {new Date(dateFrom).toLocaleDateString()} - {new Date(dateTo).toLocaleDateString()}
        </p>

        {/* Revenue */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">REVENUE</h3>
          {reportData.revenue?.items?.map((item: any, index: number) => (
            <div key={index} className="flex justify-between py-1 pl-4">
              <span className="text-gray-600">{item.name}</span>
              <span className="font-medium text-green-600">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 border-t font-bold">
            <span>Total Revenue</span>
            <span className="text-green-600">{formatCurrency(reportData.revenue?.total || 0)}</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">EXPENSES</h3>
          {reportData.expenses?.items?.map((item: any, index: number) => (
            <div key={index} className="flex justify-between py-1 pl-4">
              <span className="text-gray-600">{item.name}</span>
              <span className="font-medium text-red-600">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 border-t font-bold">
            <span>Total Expenses</span>
            <span className="text-red-600">{formatCurrency(reportData.expenses?.total || 0)}</span>
          </div>
        </div>

        {/* Net Income */}
        <div className={`flex justify-between py-3 border-t-2 border-gray-900 font-bold text-lg ${
          reportData.netIncome >= 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          <span>Net {reportData.netIncome >= 0 ? 'Profit' : 'Loss'}</span>
          <span>{formatCurrency(Math.abs(reportData.netIncome || 0))}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Financial Reports</h1>
          <p className="text-gray-600 mt-1">Generate and view comprehensive financial reports</p>
        </div>

        {/* Report Type Tabs */}
        <div className="bg-white rounded-lg shadow-sm border mb-6">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => setActiveReport('trial-balance')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeReport === 'trial-balance'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Trial Balance
            </button>
            <button
              onClick={() => setActiveReport('balance-sheet')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeReport === 'balance-sheet'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Balance Sheet
            </button>
            <button
              onClick={() => setActiveReport('profit-loss')}
              className={`px-6 py-3 font-medium whitespace-nowrap ${
                activeReport === 'profit-loss'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Profit & Loss
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
          <div className="flex items-center gap-4">
            {activeReport === 'profit-loss' && (
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {activeReport === 'profit-loss' ? 'To Date' : 'As of Date'}
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="pt-7">
              <button
                onClick={loadReport}
                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <FileText size={18} />
                Generate Report
              </button>
            </div>
            <div className="pt-7">
              <button
                onClick={exportToPDF}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Download size={18} />
                Export PDF
              </button>
            </div>
          </div>
        </div>

        {/* Report Content */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="mt-2 text-gray-600">Generating report...</p>
          </div>
        ) : (
          <>
            {activeReport === 'trial-balance' && renderTrialBalance()}
            {activeReport === 'balance-sheet' && renderBalanceSheet()}
            {activeReport === 'profit-loss' && renderProfitLoss()}
          </>
        )}
      </div>
    </div>
  );
}
