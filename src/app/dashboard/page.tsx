"use client"
import { useRouter } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart, Pie, Cell, PieLabelRenderProps
} from 'recharts';
import { fetchDashboardStats, fetchTransactionStats, fetchAgentCustomerStats } from '@/services/api';

const App = () => {
  // Simulating router functionality for a standalone app
  const router = useRouter()
  const [duration, setDuration] = useState("Last 12 months");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardStats, setDashboardStats] = useState({
    walletBalance: 0,
    allCollectionWallet: 0,
    totalDue: 0,
    smsBalance: 0,
    totalCustomers: 0,
    totalAgents: 0,
    activeLoans: 0,
    activeInvestments: 0,
    totalCollections: 0
  });
  const [transactionData, setTransactionData] = useState([]);
  const [pieData, setPieData] = useState([
    { name: 'Agents', value: 0 },
    { name: 'Customers', value: 0 },
  ]);

  const addCustomer = () => {
    router.push('/dashboard/customer');
  };
  const deposit = () => {
    router.push('/dashboard/wallet');
  };

  // Fetch dashboard data
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsResponse, transactionResponse, agentCustomerResponse] = await Promise.all([
        fetchDashboardStats(),
        fetchTransactionStats(duration),
        fetchAgentCustomerStats()
      ]);

      if (statsResponse.success) {
        setDashboardStats(statsResponse.data);
      }
      if (transactionResponse.success) {
        setTransactionData(transactionResponse.data);
      }
      if (agentCustomerResponse.success) {
        setPieData(agentCustomerResponse.data);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setError('Failed to load dashboard data. Please try again.');
      // Set default values if API fails
      setDashboardStats({
        walletBalance: 0,
        allCollectionWallet: 0,
        totalDue: 0,
        smsBalance: 0,
        totalCustomers: 0,
        totalAgents: 0,
        activeLoans: 0,
        activeInvestments: 0,
        totalCollections: 0
      });
      setTransactionData([]);
      setPieData([
        { name: 'Agents', value: 0 },
        { name: 'Customers', value: 0 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      fetchData();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [duration]);

  const PIE_COLORS = ['#A89CFB', '#2F85A5'];
  
  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: PieLabelRenderProps) => {
    if (cx === undefined || cy === undefined || midAngle === undefined || innerRadius === undefined || outerRadius === undefined || percent === undefined) {
      return null;
    }
    const numCx = Number(cx);
    const numCy = Number(cy);
    const numMidAngle = Number(midAngle);
    const numInnerRadius = Number(innerRadius);
    const numOuterRadius = Number(outerRadius);

    const radius = numInnerRadius + (numOuterRadius - numInnerRadius) * 0.5;
    const x = numCx + radius * Math.cos(-numMidAngle * Math.PI / 180);
    const y = numCy + radius * Math.sin(-numMidAngle * Math.PI / 180);

    return (
      <text
        x={x}
        y={y}
        fill="black"
        textAnchor={x > numCx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={12}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="p-2 sm:p-4 md:p-8 font-['Inter'] bg-gray-50 min-h-screen">
      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
            <div className="ml-auto pl-3">
              <div className="-mx-1.5 -my-1.5">
                <button
                  onClick={() => setError(null)}
                  className="inline-flex bg-red-50 rounded-md p-1.5 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-red-50 focus:ring-red-600"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-semibold text-xl sm:text-2xl leading-8 text-gray-900">Dashboard</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Monitor overview of all activities across customers, agents and branch</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            aria-label="Refresh dashboard"
            className="flex items-center px-4 sm:px-5 py-2.5 sm:py-3 mt-2 sm:mt-0 rounded-md border border-gray-300 bg-white text-gray-700 font-semibold text-xs sm:text-sm cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className={`w-4 h-4 mr-0 sm:mr-2 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            onClick={addCustomer}
            aria-label="Add customer"
            className="flex items-center px-4 sm:px-5 py-2.5 sm:py-3 mt-2 sm:mt-0 rounded-md border border-indigo-700 bg-indigo-700 text-white font-semibold text-xs sm:text-sm cursor-pointer hover:bg-indigo-600 transition-colors"
          >
            <svg className="w-4 h-4 mr-0 sm:mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add customer</span>
          </button>
        </div>
      </div>

      {/* Top Cards Section */}
      <div className="flex flex-col lg:flex-row gap-4 mt-6">
        <div className="w-full lg:w-1/2">
          <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-5 rounded-lg bg-[#D3CDFE] shadow-sm">
            <div>
              <p className="text-xs sm:text-sm text-gray-500">Live wallet balance</p>
              <p className="text-lg sm:text-xl font-semibold text-gray-900 mt-1">
                ₦{loading ? '...' : dashboardStats.walletBalance.toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={deposit}
              className="px-3 sm:px-4 py-2 mt-3 sm:mt-0 rounded-md bg-indigo-700 text-white font-semibold text-xs sm:text-sm cursor-pointer hover:bg-indigo-600 transition-colors"
            >
              Deposit
            </button>
          </div>
        </div>
        <div className="w-full lg:w-1/2">
          <div className="flex flex-row gap-2 sm:gap-4 p-4 sm:p-5 rounded-lg bg-white shadow-sm">
            <div className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              <div className="ml-2 sm:ml-3">
                <p className="text-xs sm:text-sm text-gray-500">All collection wallet</p>
                <p className="text-lg sm:text-xl font-semibold text-gray-900 mt-1">
                  ₦{loading ? '...' : dashboardStats.allCollectionWallet.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center ml-auto">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              <div className="ml-2 sm:ml-3">
                <p className="text-xs sm:text-sm text-gray-500">Total due</p>
                <p className="text-lg sm:text-xl font-semibold text-gray-900 mt-1">
                  ₦{loading ? '...' : dashboardStats.totalDue.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">SMS unit balance</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.smsBalance}
            </p>
          </div>
        </div>
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">Total collection</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.totalCollections.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">Agents</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.totalAgents}
            </p>
          </div>
        </div>
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">Customers</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.totalCustomers}
            </p>
          </div>
        </div>
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">Active loan</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.activeLoans}
            </p>
          </div>
        </div>
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">Active investment</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.activeInvestments}
            </p>
          </div>
        </div>
        <div className="p-5 rounded-lg bg-white shadow-sm flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm-1 4a1 1 0 100 2h4a1 1 0 100-2H6zm0 4a1 1 0 100 2h2a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <div className="ml-3 text-center">
            <p className="text-sm text-gray-500">Total collections</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">
              {loading ? '...' : dashboardStats.totalCollections.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
      
      {/* Charts Section */}
      <div className="flex flex-col lg:flex-row gap-4 mt-8">
        <div className="w-full lg:w-2/3">
          <div className="p-5 rounded-lg bg-white shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
              <p className="text-xl font-semibold text-gray-900">Transaction stats</p>
              <div className="relative mt-4 sm:mt-0 w-full sm:w-1/2 md:w-1/3">
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md appearance-none bg-white pr-10"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                >
                  <option value="Last 12 months">Last 12 months</option>
                  <option value="Last 6 months">Last 6 months</option>
                  <option value="Last 3 months">Last 3 months</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="mt-4 w-full h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={transactionData}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip cursor={{ fill: 'transparent' }} />
                  <Legend verticalAlign="top" align="center" height={36} />
                  <Bar dataKey="Collection" barSize={14} fill="#8884d8" />
                  <Bar dataKey="Loan" barSize={14} fill="#008080" />
                  <Line type="monotone" dataKey="Investment" stroke="#82ca9d" strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="w-full lg:w-1/3">
          <div className="p-5 rounded-lg bg-white shadow-sm h-full flex flex-col justify-between">
            <p className="text-xl font-semibold text-gray-900">Agent vs Customers</p>
            <div className="flex flex-col items-center justify-center flex-grow relative py-8">
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-gray-800">
                  {loading ? '...' : pieData.reduce((sum, entry) => sum + entry.value, 0)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={90}
                    fill="#8884d8"
                    paddingAngle={5}
                    startAngle={90}
                    endAngle={450}
                    label={CustomLabel}
                    labelLine={false}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center mt-4 space-x-6">
              {pieData.map((entry, index) => (
                <div key={`legend-${index}`} className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[index] }}></div>
                  <span className="text-sm text-gray-700">{entry.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
