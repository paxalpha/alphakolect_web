"use client"
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from "next/navigation";
import { ChevronDown, X, ChevronUp, ChevronRight, Menu, Calendar, Upload, Plus, CheckCircle } from 'lucide-react';
import Link from "next/link";
import '@/global.css';
import { 
  getWalletBalance, 
  fetchWalletTransactions, 
  fetchCustomerWallets, 
  transferToCustomer,
  fetchCustomers,
  createCustomerWallet,
  fetchWalletTiers,
  fetchUpgradeStatus,
  fetchMerchantProfile
} from '@/services/api';
import LoadingButton from '@/components/LoadingButton';

// The main Wallet component with tab functionality
export default function Wallet() {
  const router = useRouter();
  const [export_option, setExportOption] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isFilterCardOpen, setIsFilterCardOpen] = useState(false);
  const filterCardRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLDivElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isTierModalOpen, setIsTierModalOpen] = useState(false);
  const [isUpgradeFormOpen, setIsUpgradeFormOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [targetUpgradeTier, setTargetUpgradeTier] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: string } | null>(null);
  
  // State to manage which tab is currently active
  const [activeTab, setActiveTab] = useState('activities');

  // State for dynamic data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState({
    total: 0,
    available: 0,
    pending: 0,
    currency: 'NGN'
  });
  const [walletTransactions, setWalletTransactions] = useState([]);
  const [customerWallets, setCustomerWallets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [merchantInfo, setMerchantInfo] = useState({
    accountNumber: '',
    accountLevel: 'Tier 0',
    businessName: ''
  });
  const [walletTiers, setWalletTiers] = useState<any[]>([]);
  const [pendingUpgrade, setPendingUpgrade] = useState<any>(null);

  // Toggle the visibility of the filter card
  const toggleFilterCard = () => {
    setIsFilterCardOpen(!isFilterCardOpen);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        filterCardRef.current &&
        !filterCardRef.current.contains(event.target as Node) &&
        filterButtonRef.current &&
        !filterButtonRef.current.contains(event.target as Node)
      ) {
        setIsFilterCardOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside as unknown as EventListener);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside as unknown as EventListener);
    };
  }, []);

  // Fetch data function
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [balanceResponse, transactionsResponse, customersResponse, customerWalletsResponse, tiersResponse, upgradeResponse, profileResponse] = await Promise.all([
        getWalletBalance(),
        fetchWalletTransactions(),
        fetchCustomers(),
        fetchCustomerWallets({ page: 1, limit: 100 }),
        fetchWalletTiers(),
        fetchUpgradeStatus(),
        fetchMerchantProfile()
      ]);

      if (balanceResponse.success) {
        setWalletBalance(balanceResponse.balance);
      }

      if (tiersResponse.message.includes('successfully')) {
        setWalletTiers(tiersResponse.tiers);
      }
      
      if (transactionsResponse.success) {
        console.log('Raw transaction data from API:', transactionsResponse.transactions);
        const formattedTransactions = transactionsResponse.transactions.map((tx: any) => {
          // Use transactionType (customer perspective) if available, otherwise fall back to type
          // transactionType represents what the user selected (credit/debit from customer's perspective)
          // type represents the merchant's perspective (opposite of what user selected)
          const userSelectedType = tx.transactionType || tx.type;
          const isDebit = userSelectedType === 'debit';
          const amountNum = parseFloat(tx.amount);
          
          const formattedTx = {
            refId: tx.reference,
            type: isDebit ? 'Debit' : 'Credit',
            amount: `${isDebit ? '-' : ''}₦${Math.abs(amountNum).toLocaleString()}`,
            transactionType: isDebit ? 'Debit' : 'Credit',
            paymentMethod: tx.payment_method || tx.paymentMethod || '—',
            date: new Date(tx.date || tx.createdAt).toLocaleDateString('en-GB'),
            status: tx.status === 'Completed' ? 'Successful' : tx.status
          };
          
          console.log(`Transaction ${tx.reference}: userSelectedType=${userSelectedType}, isDebit=${isDebit}, display=${formattedTx.amount}`);
          return formattedTx;
        });
        setWalletTransactions(formattedTransactions);
      }

      if (customersResponse.customers) {
        setCustomers(customersResponse.customers);
      } else {
        setCustomers([]);
      }

      if (customerWalletsResponse.success && customerWalletsResponse.wallets) {
        const formattedWallets = customerWalletsResponse.wallets.map((wallet: any) => ({
          customerName: wallet.customer?.fullName || 'Unknown Customer',
          accountNumber: wallet.accountNumber,
          accountLevel: wallet.accountLevel,
          balance: `₦${Math.abs(parseFloat(wallet.balance || 0)).toLocaleString()}`,
          lastTransactionDate: new Date(wallet.activationDate || wallet.createdAt).toLocaleDateString('en-GB'),
          status: wallet.status,
          customerId: wallet.customerId,
          merchantId: wallet.merchantId
        }));
        setCustomerWallets(formattedWallets);
      } else {
        setCustomerWallets([]);
      }

      if (upgradeResponse && upgradeResponse.success) {
        setPendingUpgrade(upgradeResponse.request);
      }

      if (profileResponse && profileResponse.success) {
        const merchant = profileResponse.merchant;
        setMerchantInfo({
          accountNumber: merchant.accountNumber || '0112435467',
          accountLevel: merchant.accountLevel || 'Tier 0',
          businessName: merchant.businessName || merchant.name || 'Merchant'
        });
      }

    } catch (error) {
      console.error('Error fetching wallet data:', error);
      setError('Failed to load wallet data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    fetchData();
    
    // Load merchant info from localStorage
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setMerchantInfo({
          accountNumber: user.accountNumber || '0112435467',
          accountLevel: user.accountLevel || 'Tier 3',
          businessName: user.businessName || user.fullName || 'Gbenga daniel'
        });
      } catch (e) {
        console.error('Error parsing user data', e);
      }
    }
  }, []);

  // Use dynamic data instead of mock data
  const mockData = walletTransactions;
  const mockCustomerData = customerWallets;

  const itemsPerPage = 10;

  // Use useMemo to sort the data efficiently based on the active tab
  const sortedItems = useMemo(() => {
    const dataToSort = activeTab === 'activities' ? mockData : mockCustomerData;
    let sortableItems = [...dataToSort];
    if (sortConfig !== null) {
      sortableItems.sort((a: any, b: any) => {
        // Handle number sorting for amount and balance
        const valA = sortConfig.key === 'amount' || sortConfig.key === 'balance' ? parseInt(a[sortConfig.key].replace(/₦|,/g, ''), 10) : a[sortConfig.key];
        const valB = sortConfig.key === 'amount' || sortConfig.key === 'balance' ? parseInt(b[sortConfig.key].replace(/₦|,/g, ''), 10) : b[sortConfig.key];
        
        if (valA < valB) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [mockData, mockCustomerData, sortConfig, activeTab]);

  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = sortedItems.slice(startIndex, startIndex + itemsPerPage);

  // A function to handle the sorting request
  const requestSort = (key: string) => {
    let direction = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // A function to get the appropriate sorting icon
  const getSortIcon = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) {
      return (
        <div className="flex flex-col ml-1">
          <ChevronUp className="h-3 w-3 text-gray-400" />
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </div>
      );
    }
    if (sortConfig.direction === 'asc') {
      return (
        <div className="flex flex-col ml-1">
          <ChevronUp className="h-3 w-3 text-blue-500" />
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </div>
      );
    }
    return (
      <div className="flex flex-col ml-1">
        <ChevronUp className="h-3 w-3 text-gray-400" />
        <ChevronDown className="h-3 w-3 text-blue-500" />
      </div>
    );
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const renderPaginationButtons = () => {
    const buttons = [];
    const maxVisibleButtons = 5;

    // Show first page button
    buttons.push(
      <button
        key={1}
        onClick={() => handlePageChange(1)}
        className={`px-4 py-2 rounded-lg ${currentPage === 1 ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'}`}
      >
        1
      </button>
    );

    // Show ellipsis if current page is far from the beginning
    if (currentPage > maxVisibleButtons - 1) {
      buttons.push(<span key="ellipsis-start" className="px-4 py-2 text-gray-700">...</span>);
    }

    // Determine the start and end of the visible page number range
    let startPage = Math.max(2, currentPage - 1);
    let endPage = Math.min(totalPages - 1, currentPage + 1);

    // Adjust the range if we are at the beginning or end of pages
    if (currentPage < 3) {
      endPage = Math.min(totalPages - 1, 3);
    }
    if (currentPage > totalPages - 2) {
      startPage = Math.max(2, totalPages - 2);
    }

    // Render the page number buttons in the visible range
    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`px-4 py-2 rounded-lg ${currentPage === i ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          {i}
        </button>
      );
    }

    // Show ellipsis if current page is far from the end
    if (currentPage < totalPages - 2) {
      buttons.push(<span key="ellipsis-end" className="px-4 py-2 text-gray-700">...</span>);
    }

    // Show last page button, but only if there are more than 1 page
    if (totalPages > 1 && totalPages !== 1) {
      buttons.push(
        <button
          key={totalPages}
          onClick={() => handlePageChange(totalPages)}
          className={`px-4 py-2 rounded-lg ${currentPage === totalPages ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          {totalPages}
        </button>
      );
    }

    return buttons;
  };
  
  const handleTabChange = (tabName: string) => {
    setActiveTab(tabName);
    setCurrentPage(1); // Reset page to 1 on tab switch
    setSortConfig(null); // Reset sorting on tab switch
  };

  return (
    <div className="relative min-h-screen pt-3">
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

      <h1 className="font-inter font-semibold text-2xl leading-8 ">Wallets</h1>
      <div className="flex flex-col md:flex-row md:items-center">
        <p className="text-sm">Manage transactions and balances across organization and customer wallets.</p>
        <div className="mt-4 md:ml-auto md:mt-0 w-full md:w-auto flex gap-2">
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="auth-btn flex justify-center w-full md:w-auto"
            style={{ background: 'none', border: '1px solid #6B7280', color: '#6B7280' }}
          >
            <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            &nbsp;&nbsp; {loading ? 'Wait' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="auth-btn flex justify-center w-full md:w-auto"
            style={{ background: 'none', border: '1px solid #4E37FB', color: '#4E37FB' }}
          >
            {/* The icon can be an SVG or a library component like Lucide-React's Plus */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-plus-circle w-5 h-5">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
              <path d="M12 8v8" />
            </svg>
            &nbsp;&nbsp; <div className='mb-1'>
              Transfer
            </div>
          </button>
        </div>
      </div>
      {/* The Sidebar Component */}
      <Sidebar 
        isSidebarOpen={isSidebarOpen} 
        setIsSidebarOpen={setIsSidebarOpen} 
        customers={customers} 
        setWalletBalance={setWalletBalance}
      />
      <TierModal 
        isOpen={isTierModalOpen} 
        onClose={() => setIsTierModalOpen(false)} 
        currentTier={merchantInfo.accountLevel.includes('3') ? 3 : (merchantInfo.accountLevel.includes('2') ? 2 : (merchantInfo.accountLevel.includes('1') ? 1 : 0))} 
        onUpgradeSelect={(tier) => {
          setTargetUpgradeTier(tier);
          setIsTierModalOpen(false);
          setIsUpgradeFormOpen(true);
        }}
        tiers={walletTiers}
      />
      <UpgradeFormModal 
        isOpen={isUpgradeFormOpen}
        onClose={() => setIsUpgradeFormOpen(false)}
        tier={targetUpgradeTier}
        tiers={walletTiers}
        onSuccess={() => {
          setIsUpgradeFormOpen(false);
          setIsSuccessModalOpen(true);
        }}
      />
       <SuccessModal 
        isOpen={isSuccessModalOpen}
        onClose={() => {
          setIsSuccessModalOpen(false);
          fetchData();
        }}
      />
      <div className="flex flex-col md:flex-row gap-4 mt-4">
        <div className="w-full">
          <div className="flex flex-col md:flex-row gap-4 mt-4">
            <div className="w-full md:w-3/12">
              <div className="balance-overview flex flex-col justify-center min-h-[100px]">
                <p className="text-xs text-gray-500 font-medium mb-2">Live wallet balance</p>
                <p className="text-xl font-bold text-black">
                  {loading ? 'Loading...' : `₦${walletBalance.total.toLocaleString()}`}
                </p>
              </div>
            </div>
            <div className="w-full md:w-5/12">
              <div className="balance-overview flex flex-col justify-between min-h-[100px]">
                <div className="flex justify-between items-start">
                  <p className="text-xs text-gray-500 font-medium">Paga - {merchantInfo.businessName}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-gray-500 font-medium">Live account: {merchantInfo.accountLevel}</p>
                    {pendingUpgrade?.status === 'pending' ? (
                      <span className="bg-[#1A06C5] text-white text-[9px] px-2 py-0.5 rounded-full font-medium">validating</span>
                    ) : pendingUpgrade?.status === 'rejected' ? (
                      <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full font-medium">declined</span>
                    ) : (
                      <span className="bg-[#12B76A] text-white text-[9px] px-2 py-0.5 rounded-full font-medium">active</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-end mt-2">
                  <p className="text-xl font-bold text-black">
                    {merchantInfo.accountNumber}
                  </p>
                  <button 
                    onClick={() => setIsTierModalOpen(true)}
                    className="text-[#4E37FB] text-sm font-semibold hover:underline"
                  >
                    Upgrade wallet
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="dashboard-card bg-white mt-3 gap-4">
            <div className="tab-section flex gap-5">
              <button 
                onClick={() => handleTabChange('activities')} 
                className={`tab-btn ${activeTab === 'activities' ? 'active-tab' : 'inactive-tab'}`}
              >
                Wallet activities
              </button>
              <button 
                onClick={() => handleTabChange('customer-wallets')} 
                className={`tab-btn ${activeTab === 'customer-wallets' ? 'active-tab' : 'inactive-tab'}`}
              >
                Customer wallets
              </button>
            </div>
            <div className="divider mt-3"></div>
            
            {activeTab === 'activities' && (
              <>
                <div className="flex mt-4 flex-col sm:flex-row sm:items-center gap-3">
                  <div className="relative inline-block w-full sm:w-auto">
                    <div className="flex filter-btn items-center px-4 py-3"
                      ref={filterButtonRef}
                      onClick={toggleFilterCard}
                    >
                      {/* Using inline SVG for filter icon for self-containment */}
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-filter"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>&nbsp;&nbsp;
                      <p>Filter</p>
                    </div>
                    {isFilterCardOpen && (
                      <div
                        ref={filterCardRef}
                        className="cursor-pointer filter-card absolute p-2 rounded-lg bg-white transition-colors duration-200"
                        style={{ zIndex: 10 }}
                      >
                        <div className="p-4 space-y-4">
                          {/* Header */}
                          <div className="flex w-full">
                            <h3 className="filter-title">Choose your filters</h3>
                            <div className="ml-auto">
                              <button type="button" className="clear-btn">Clear filters</button>
                            </div>
                          </div>

                          {/* Status Section */}
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">Status</p>
                            <div className="flex space-x-4">
                              <label className="inline-flex items-center">
                                <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                                <span className="ml-2 text-sm text-gray-700">Successful</span>
                              </label>
                              <label className="inline-flex items-center">
                                <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                                <span className="ml-2 text-sm text-gray-700">Failed</span>
                              </label>
                            </div>
                          </div>

                          {/* Type Section */}
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">Type</p>
                            <div className="flex space-x-4">
                              <label className="inline-flex items-center">
                                <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                                <span className="ml-2 text-sm text-gray-700">Credit</span>
                              </label>
                              <label className="inline-flex items-center">
                                <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                                <span className="ml-2 text-sm text-gray-700">Debit</span>
                              </label>
                            </div>
                          </div>

                          {/* Source/To Section */}
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">Source/To</p>
                            <div className="flex space-x-4">
                              <label className="inline-flex items-center">
                                <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                                <span className="ml-2 text-sm text-gray-700">Cash</span>
                              </label>
                              <label className="inline-flex items-center">
                                <input type="checkbox" className="form-checkbox h-4 w-4 text-indigo-600 rounded" />
                                <span className="ml-2 text-sm text-gray-700">Bank account</span>
                              </label>
                            </div>
                          </div>
                        </div>

                        {/* Footer Buttons */}
                        <div className="flex justify-end p-4 space-x-2 border-t border-gray-200">
                          <button
                            onClick={() => setIsFilterCardOpen(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors duration-200"
                          >
                            Close
                          </button>
                          <button type="button" className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 rounded-md duration-200">
                            Add filters
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="ml-0 sm:ml-auto flex flex-col sm:flex-row gap-3 w-full">
                    <div className="relative sm:w-[100px] md:w-[120px] w-full">
                      <select
                        className="input-field appearance-none w-full"
                        value={export_option}
                        onChange={(e) => setExportOption(e.target.value)}
                      >
                        <option value="Last 12 months">Export</option>
                        <option value="PDF">PDF</option>
                        <option value="CSV">CSV</option>
                      </select>
                      <div className="pointer-events-none absolute right-3 top-9 flex items-center">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-1 w-full flex justify-start md:justify-end">
                      <div className="relative w-full md:w-64 pl-0">
                        <div className="absolute inset-y-0 left-0 pl-3 pt-5 flex items-center pointer-events-none">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="lucide lucide-search text-gray-400"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                        </div>
                        <input
                          type="text"
                          className="search-input w-full pl-10"
                          placeholder="Search"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-white max-w-6xl mx-auto mt-3">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="table-header">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('refId')} className="flex items-center focus:outline-none">
                              Ref ID
                              {getSortIcon('refId')}
                            </button>
                          </th>
                          {/* <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('type')} className="flex items-center focus:outline-none">
                              Type
                              {getSortIcon('type')}
                            </button>
                          </th> */}
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('amount')} className="flex items-center focus:outline-none">
                              Amount
                              {getSortIcon('amount')}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('transactionType')} className="flex items-center focus:outline-none">
                              Transaction Type
                              {getSortIcon('transactionType')}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('paymentMethod')} className="flex items-center focus:outline-none">
                              Payment Method
                              {getSortIcon('paymentMethod')}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('date')} className="flex items-center focus:outline-none">
                              Date
                              {getSortIcon('date')}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('status')} className="flex items-center focus:outline-none">
                              Status
                              {getSortIcon('status')}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center">
                                <svg className="animate-spin h-5 w-5 text-indigo-500 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Loading transactions...
                              </div>
                            </td>
                          </tr>
                        ) : currentItems.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                              No transactions found
                            </td>
                          </tr>
                        ) : (
                          currentItems.map((item:any, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.refId}</td>
                            {/* <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.type}</td> */}
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.amount}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.transactionType}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.paymentMethod}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.date}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="flex items-center px-4 py-2 border rounded-lg text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="rotate-180 h-4 w-4 mr-2" />
                      Previous
                    </button>

                    <div className="flex space-x-2">
                      {renderPaginationButtons()}
                    </div>

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="flex items-center px-4 py-2 border rounded-lg text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'customer-wallets' && (
              <>
                <div className="flex mt-4 flex-col sm:flex-row sm:items-center gap-3">
                  <div className="relative w-full sm:w-auto">
                    <select
                      className="block w-full rounded-lg border border-gray-300 pl-4 pr-10 py-3 text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none cursor-pointer"
                    >
                      <option value={10}>All account tier</option>
                    </select>
                    <div className="pointer-events-none pt-5 absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                      <ChevronDown className="h-5  w-5" />
                    </div>
                  </div>
                  <div className="ml-0 sm:ml-auto flex flex-col sm:flex-row gap-3 w-full">
                    <div className="relative sm:w-[100px] md:w-[120px] w-full">
                      <select
                        className="input-field appearance-none w-full"
                        value={export_option}
                        onChange={(e) => setExportOption(e.target.value)}
                      >
                        <option value="">Export</option>
                        <option value="PDF">PDF</option>
                        <option value="CSV">CSV</option>
                      </select>
                      <div className="pointer-events-none absolute right-3 top-9 flex items-center">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-1 w-full flex justify-start md:justify-end">
                      <div className="relative w-full md:w-64 pl-0">
                        <div className="absolute inset-y-0 left-0 pl-3 pt-5 flex items-center pointer-events-none">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="lucide lucide-search text-gray-400"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                        </div>
                        <input
                          type="text"
                          className="search-input w-full pl-10"
                          placeholder="Search"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-white max-w-6xl mx-auto mt-3">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="table-header">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('customerName')} className="flex items-center focus:outline-none">
                              Customer
                              {getSortIcon('customerName')}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button className="flex items-center focus:outline-none">
                              Wallet Account Number
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button className="flex items-center focus:outline-none">
                              Account Level
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button className="flex items-center focus:outline-none">
                              Wallet Balance
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <button onClick={() => requestSort('lastTransactionDate')} className="flex items-center focus:outline-none">
                              Date activated
                              {getSortIcon('lastTransactionDate')}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center">
                                <svg className="animate-spin h-5 w-5 text-indigo-500 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Loading customer wallets...
                              </div>
                            </td>
                          </tr>
                        ) : currentItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                              No customer wallets found
                            </td>
                          </tr>
                        ) : (
                          currentItems.map((item: any, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.customerName}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.accountNumber}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.accountLevel}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.balance}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.lastTransactionDate}</td>
                          </tr>
                        ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="flex items-center px-4 py-2 border rounded-lg text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="rotate-180 h-4 w-4 mr-2" />
                      Previous
                    </button>

                    <div className="flex space-x-2">
                      {renderPaginationButtons()}
                    </div>

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="flex items-center px-4 py-2 border rounded-lg text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}

// Sidebar Component
interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  customers: any[];
  setWalletBalance: React.Dispatch<React.SetStateAction<{
    total: number;
    available: number;
    pending: number;
    currency: string;
  }>>;
}

const Sidebar = ({ isSidebarOpen, setIsSidebarOpen, customers, setWalletBalance }: SidebarProps) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState('');
  

  const [transferForm, setTransferForm] = useState({
    customerId: '',
    amount: '',
    description: '',
    transactionType: 'credit', // debit or credit relative to customer wallet
    paymentMethod: 'Cash'
  });

  // Handle transfer submission
  const handleTransferSubmit = async () => {
    try {
      if (!transferForm.transactionType) {
        alert('Please choose a transaction type');
        return;
      }
      if (!transferForm.customerId || !transferForm.amount) {
        alert('Please fill in all required fields');
        return;
      }

      setTransferring(true);
      
      // Find the customer by account number or ID
      const selectedCustomer = customers.find(customer => String(customer.id) === String(transferForm.customerId));
      
      if (!selectedCustomer) {
        alert('Customer not found');
        return;
      }

      const customerId = parseInt(selectedCustomer.id || selectedCustomer.customerId || '0');

      try {
        setTransferStatus('Attempting transfer...');
        // First, try to transfer directly
      const response = await transferToCustomer({
          customerId: customerId,
        amount: parseFloat(transferForm.amount),
          description: transferForm.description,
          transactionType: transferForm.transactionType,
          type: transferForm.transactionType as 'credit' | 'debit',
          paymentMethod: transferForm.paymentMethod
      });

      if (response.success) {
          setTransferStatus('Transfer completed successfully!');
          // Immediately refresh the balance data
          try {
            const balanceResponse = await getWalletBalance();
            if (balanceResponse.success) {
              setWalletBalance(balanceResponse.balance);
            }
          } catch (balanceError) {
            console.error('Failed to refresh balance:', balanceError);
          }
          
          setTimeout(() => {
            setTransferForm({ customerId: '', amount: '', description: '', transactionType: 'credit', paymentMethod: 'Cash' });
        setIsSidebarOpen(false);
        // Refresh the page to show updated data
        window.location.reload();
          }, 1500);
          return;
        }
      } catch (transferError: any) {
        // If transfer fails due to missing wallet, try to create one
        if (transferError.message && transferError.message.includes('Customer wallet not found')) {
          try {
            setTransferStatus('Creating customer wallet...');
            // Create customer wallet first
            const walletResponse = await createCustomerWallet({
              customerId: customerId,
              accountNumber: selectedCustomer.accountNumber || `CW${Date.now()}`,
              balance: 0,
              notes: 'Auto-created wallet for transfer'
            });

            if (walletResponse.success) {
              setTransferStatus('Wallet created! Completing transfer...');
              // Now try the transfer again
              const retryResponse = await transferToCustomer({
                customerId: customerId,
                amount: parseFloat(transferForm.amount),
                description: transferForm.description,
                transactionType: transferForm.transactionType,
                type: transferForm.transactionType as 'credit' | 'debit',
                paymentMethod: transferForm.paymentMethod
              });

              if (retryResponse.success) {
                setTransferStatus('Transfer completed successfully! Customer wallet was automatically created.');
                // Immediately refresh the balance data
                try {
                  const balanceResponse = await getWalletBalance();
                  if (balanceResponse.success) {
                    setWalletBalance(balanceResponse.balance);
                  }
                } catch (balanceError) {
                  console.error('Failed to refresh balance:', balanceError);
                }
                
                setTimeout(() => {
                  setTransferForm({ customerId: '', amount: '', description: '', transactionType: 'credit', paymentMethod: 'Cash' });
                  setIsSidebarOpen(false);
                  // Refresh the page to show updated data
                  window.location.reload();
                }, 1500);
                return;
              }
            }
          } catch (walletError: any) {
            console.error('Failed to create customer wallet:', walletError);
            setTransferStatus('Failed to create customer wallet: ' + walletError.message);
            setTimeout(() => setTransferStatus(''), 3000);
            return;
          }
        }
        
        // If we get here, the transfer failed for another reason
        throw transferError;
      }
    } catch (error) {
      console.error('Transfer failed:', error);
      // Show immediate alert with backend message (e.g., "Insufficient balance in merchant wallet")
      alert((error as Error)?.message || 'Transfer failed');
      setTransferStatus('Transfer failed: ' + (error as Error).message);
      setTimeout(() => setTransferStatus(''), 3000);
    } finally {
      setTransferring(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setIsSidebarOpen(false);
      }
    }

    if (isSidebarOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSidebarOpen, setIsSidebarOpen]);

  return (
    <>
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300 ease-in-out"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      <aside
        ref={sidebarRef as React.LegacyRef<HTMLElement>}
        className={`
          fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out z-50
          ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col
        `}
      >
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-800">Transfer to customer</h2>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 text-gray-500 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 flex-grow overflow-y-auto space-y-6">
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
              Amount <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1 rounded-md shadow-sm">
              <input
                type="number"
                name="amount"
                id="amount"
                className="block w-full rounded-md border-gray-300 px-4 py-2 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                value={transferForm.amount}
                onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                required
              />
            </div>
            {transferForm.amount && parseFloat(transferForm.amount) <= 0 && (
              <p className="mt-1 text-sm text-red-600">Amount must be greater than 0</p>
            )}
          </div>

          <div>
            <label htmlFor="transaction-type" className="block text-sm font-medium text-gray-700 mb-1">
              Transaction Type <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1 rounded-md shadow-sm">
              <select
                id="transaction-type"
                name="transaction-type"
                className="block w-full rounded-md border-gray-300 pl-4 pr-10 py-2 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
                value={transferForm.transactionType}
                onChange={(e) => setTransferForm({ ...transferForm, transactionType: e.target.value })}
                required
              >
                <option value="">Choose Transaction Type</option>
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="payment-method" className="block text-sm font-medium text-gray-700 mb-1">
              Payment Method <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1 rounded-md shadow-sm">
              <select
                id="payment-method"
                name="payment-method"
                className="block w-full rounded-md border-gray-300 pl-4 pr-10 py-2 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
                value={transferForm.paymentMethod}
                onChange={(e) => setTransferForm({ ...transferForm, paymentMethod: e.target.value })}
              >
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="POS">POS</option>
                <option value="Cheque">Cheque</option>
                <option value="Mobile Money">Mobile Money</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="transfer-to" className="block text-sm font-medium text-gray-700 mb-1">
              Select Customer <span className="text-red-500">*</span>
              <span className="text-xs text-gray-500 ml-2">({customers.length} available)</span>
            </label>
            
            {/* Customer Search Input */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Search customers by name, phone, or email..."
                className="block w-full rounded-md border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500"
                onChange={(e) => {
                  const searchTerm = e.target.value.toLowerCase();
                  const filteredCustomers = customers.filter((customer: any) => {
                    const name = (customer.fullName || customer.customerName || '').toLowerCase();
                    const phone = (customer.phoneNumber || '').toLowerCase();
                    const email = (customer.email || '').toLowerCase();
                    const accountNumber = (customer.accountNumber || '').toLowerCase();
                    return name.includes(searchTerm) || phone.includes(searchTerm) || email.includes(searchTerm) || accountNumber.includes(searchTerm);
                  });
                  // You could add state for filtered customers here if needed
                }}
              />
            </div>
            
            <div className="relative mt-1 rounded-md shadow-sm">
              <select
                id="transfer-to"
                name="transfer-to"
                className="block w-full rounded-md border-gray-300 pl-4 pr-10 py-2 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none cursor-pointer"
                value={transferForm.customerId}
                onChange={(e) => setTransferForm({ ...transferForm, customerId: e.target.value })}
                disabled={customers.length === 0}
              >
                <option value="">
                  {customers.length === 0 ? 'No customers available' : 'Select a customer to transfer to'}
                </option>
                {customers.map((customer: any) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.fullName || customer.customerName} - {customer.accountNumber || customer.phoneNumber || customer.email}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
            
            {customers.length === 0 && (
              <div className="mt-2 p-3 bg-yellow-50 rounded-md border border-yellow-200">
                <p className="text-sm text-yellow-800">
                  No customers available. Please add customers first.
                </p>
          </div>
            )}
            
            {transferForm.customerId && (
              <div className="mt-2 p-3 bg-blue-50 rounded-md border border-blue-200">
                <p className="text-sm text-blue-800">
                  <span className="font-medium">Selected Customer:</span> {
                    customers.find((c: any) => (c.accountNumber || c.id) === transferForm.customerId)?.fullName || 
                    customers.find((c: any) => (c.accountNumber || c.id) === transferForm.customerId)?.customerName
                  }
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Account: {transferForm.customerId}
                </p>
                <p className="text-xs text-blue-600">
                  Phone: {customers.find((c: any) => (c.accountNumber || c.id) === transferForm.customerId)?.phoneNumber || 'N/A'}
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  <span className="font-medium">Note:</span> If this customer doesn't have a wallet, one will be automatically created during the transfer.
                </p>
            </div>
            )}
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <div className="relative mt-1 rounded-md shadow-sm">
              <input
                type="text"
                name="description"
                id="description"
                className="block w-full rounded-md border-gray-300 px-4 py-2 text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="e.g., Payment for services"
                value={transferForm.description}
                onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
              />
            </div>
          </div>
          
          {/* Transfer Summary */}
          {transferForm.customerId && transferForm.amount && (
            <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Transfer Summary</h4>
              <div className="space-y-1 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>To:</span>
                  <span className="font-medium">
                    {customers.find((c: any) => (c.accountNumber || c.id) === transferForm.customerId)?.fullName || 
                     customers.find((c: any) => (c.accountNumber || c.id) === transferForm.customerId)?.customerName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Type:</span>
                  <span className="font-medium capitalize">{transferForm.transactionType}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payment Method:</span>
                  <span className="font-medium">{transferForm.paymentMethod}</span>
                </div>
                <div className="flex justify-between">
                  <span>Amount:</span>
                  <span className="font-medium">₦{parseFloat(transferForm.amount || '0').toLocaleString()}</span>
                </div>
                {transferForm.description && (
                  <div className="flex justify-between">
                    <span>Description:</span>
                    <span className="font-medium">{transferForm.description}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Transfer Status */}
        {transferStatus && (
          <div className="px-6 py-3 border-t border-gray-200">
            <div className={`p-3 rounded-md text-sm ${
              transferStatus.includes('successfully') || transferStatus.includes('completed') 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : transferStatus.includes('failed') || transferStatus.includes('Failed')
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}>
              {transferStatus}
            </div>
          </div>
        )}

        <div className="p-6 border-t border-gray-200 flex justify-center">
          <LoadingButton
            onClick={handleTransferSubmit}
            loading={transferring}
            loadingText={transferStatus || "Transferring..."}
            className="btn-sm"
            disabled={!transferForm.customerId || !transferForm.amount || parseFloat(transferForm.amount || '0') <= 0}
          >
            {transferring ? (transferStatus || 'Transferring...') : 'Transfer'}
          </LoadingButton>
        </div>
      </aside>
    </>
  );
};

// Tier Modal Component
interface TierModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier: number;
  onUpgradeSelect: (tier: number) => void;
}

const TierModal = ({ isOpen, onClose, currentTier, onUpgradeSelect, tiers: dynamicTiers }: TierModalProps & { tiers: any[] }) => {
  const tiers = useMemo(() => {
    if (dynamicTiers && dynamicTiers.length > 0) {
      return dynamicTiers.map(t => ({
        level: t.level,
        title: `${t.name}`,
        badge: t.level === currentTier ? 'Current' : (t.level === currentTier + 1 ? 'Next level' : ''),
        dailyLimit: t.dailyLimit || 'NO',
        maxBalance: t.maxBalance || 'NO',
        requirements: t.requirements || [],
        bgColor: t.level === currentTier ? 'bg-[#4E37FB]' : 'bg-[#FAF9FF]',
        textColor: t.level === currentTier ? 'text-white' : 'text-gray-900',
        badgeColor: t.level === currentTier ? 'bg-white/20 text-white' : 'bg-[#E0E7FF] text-[#4E37FB]'
      }));
    }
    
    // Fallback static tiers if API fails or empty
    return [
      {
        level: 0,
        title: 'Starter',
        badge: currentTier === 0 ? 'Current' : '',
        dailyLimit: 'NO',
        maxBalance: 'NO',
        requirements: ['Register'],
        bgColor: currentTier === 0 ? 'bg-[#4E37FB]' : 'bg-[#FAF9FF]',
        textColor: currentTier === 0 ? 'text-white' : 'text-gray-900',
        badgeColor: 'bg-white/20 text-white'
      },
      {
        level: 1,
        title: 'Basic verification',
        badge: currentTier === 1 ? 'Current' : (currentTier === 0 ? 'Next level' : ''),
        dailyLimit: '₦50,000',
        maxBalance: '₦100,000',
        requirements: ['Name', 'Phone number', 'Email'],
        bgColor: currentTier === 1 ? 'bg-[#4E37FB]' : 'bg-[#FAF9FF]',
        textColor: currentTier === 1 ? 'text-white' : 'text-gray-900',
        badgeColor: 'bg-white/20 text-white'
      },
      {
        level: 2,
        title: 'KYC verification',
        badge: currentTier === 2 ? 'Current' : (currentTier === 1 ? 'Next level' : ''),
        dailyLimit: '₦500,000',
        maxBalance: '₦2,000,000',
        requirements: ['Government ID', 'Selfie/face match', 'Date of birth'],
        bgColor: currentTier === 2 ? 'bg-[#4E37FB]' : 'bg-[#FAF9FF]',
        textColor: currentTier === 2 ? 'text-white' : 'text-gray-900',
        badgeColor: 'bg-white/20 text-white'
      },
      {
        level: 3,
        title: 'Business/Merchant',
        badge: currentTier === 3 ? 'Current' : (currentTier === 2 ? 'Next level' : ''),
        dailyLimit: '₦2,500,000',
        maxBalance: '₦4,000,000',
        requirements: ['Business registration', 'Director details', 'Proof of address'],
        bgColor: currentTier === 3 ? 'bg-[#4E37FB]' : 'bg-[#FAF9FF]',
        textColor: currentTier === 3 ? 'text-white' : 'text-gray-900',
        badgeColor: 'bg-white/20 text-white'
      }
    ];
  }, [dynamicTiers, currentTier]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />
      <div className="relative bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">Wallet account Tiers</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="h-6 w-6 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 overflow-y-auto max-h-[70vh] space-y-4 hide-scrollbar">
          {tiers.map((tier, idx) => (
            <div 
              key={idx} 
              className={`p-5 rounded-xl border ${tier.bgColor} ${tier.textColor} transition-all duration-200 hover:shadow-md cursor-pointer ${tier.level > currentTier ? 'border-transparent' : 'border-indigo-100'}`}
              onClick={() => tier.level > currentTier && onUpgradeSelect(tier.level)}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">{tier.title}</h3>
                {tier.badge && (
                  <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${tier.badgeColor}`}>
                    {tier.badge}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className={`text-[10px] ${tier.level === 0 ? 'text-white/70' : 'text-gray-500'}`}>Daily transaction limit</p>
                  <p className="font-bold text-base">{tier.dailyLimit}</p>
                </div>
                <div>
                  <p className={`text-[10px] ${tier.level === 0 ? 'text-white/70' : 'text-gray-500'}`}>Maximum balance</p>
                  <p className="font-bold text-base">{tier.maxBalance}</p>
                </div>
              </div>

              <div>
                <p className={`text-[10px] mb-2 ${tier.level === 0 ? 'text-white/70' : 'text-gray-500'}`}>Requirements</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {(tier.requirements || []).map((req: any, ridx: number) => (
                    <div key={ridx} className="flex items-center text-xs font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-current mr-2 opacity-60" />
                      {String(req)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-6 border-t bg-white flex justify-center">
          <button 
            className="w-full max-w-xs bg-[#4E37FB] text-white py-4 rounded-lg font-bold text-sm tracking-wide hover:bg-[#3d2dd8] transition-all transform active:scale-95 shadow-lg shadow-indigo-200"
            onClick={() => onUpgradeSelect(currentTier + 1)}
          >
            Upgrade for ₦20,000
          </button>
        </div>
      </div>
    </div>
  );
};

// Upgrade Form Modal Component
interface UpgradeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tier: number;
  tiers?: any[];
  onSuccess: () => void;
}

const UpgradeFormModal = ({ isOpen, onClose, tier, tiers = [], onSuccess }: UpgradeFormModalProps) => {
  const [formData, setFormData] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<any>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  if (!isOpen) return null;

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (tier === 1) {
      if (!formData.fullName) newErrors.fullName = 'Full name is required';
      if (!formData.phone) newErrors.phone = 'Phone number is required';
      if (!formData.email) newErrors.email = 'Email address is required';
      else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Invalid email format';
    } 
    else if (tier === 2) {
      if (!formData.dob) newErrors.dob = 'Date of birth is required';
      if (!formData.idType) newErrors.idType = 'ID type is required';
      if (!files.governmentId) newErrors.governmentId = 'Government ID is required';
      if (!files.selfie) newErrors.selfie = 'Selfie is required';
    } 
    else if (tier === 3) {
      if (!formData.rcNumber) newErrors.rcNumber = 'Registration number is required';
      if (!formData.directorName) newErrors.directorName = 'Director name is required';
      if (!files.proofOfAddress) newErrors.proofOfAddress = 'Proof of address is required';
      if (!files.businessCert) newErrors.businessCert = 'Business certificate is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const renderFields = () => {
    switch(tier) {
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
              <input 
                type="text" 
                className={`w-full border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 ${errors.fullName ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`} 
                placeholder="Enter full name"
                value={formData.fullName || ''}
                onChange={(e) => {
                  setFormData({ ...formData, fullName: e.target.value });
                  if (errors.fullName) setErrors({ ...errors, fullName: '' });
                }}
              />
              {errors.fullName && <p className="text-[10px] text-red-500 mt-1">{errors.fullName}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone Number</label>
              <input 
                type="tel" 
                className={`w-full border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 ${errors.phone ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`} 
                placeholder="Enter phone number" 
                value={formData.phone || ''}
                onChange={(e) => {
                  setFormData({ ...formData, phone: e.target.value });
                  if (errors.phone) setErrors({ ...errors, phone: '' });
                }}
              />
              {errors.phone && <p className="text-[10px] text-red-500 mt-1">{errors.phone}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email Address</label>
              <input 
                type="email" 
                className={`w-full border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 ${errors.email ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`} 
                placeholder="Enter email address" 
                value={formData.email || ''}
                onChange={(e) => {
                  setFormData({ ...formData, email: e.target.value });
                  if (errors.email) setErrors({ ...errors, email: '' });
                }}
              />
              {errors.email && <p className="text-[10px] text-red-500 mt-1">{errors.email}</p>}
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date of birth</label>
              <div className="relative">
                <input 
                  type="text" 
                  className={`w-full border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 ${errors.dob ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`} 
                  placeholder="DD/MM/YYYY" 
                  value={formData.dob || ''}
                  onChange={(e) => {
                    setFormData({ ...formData, dob: e.target.value });
                    if (errors.dob) setErrors({ ...errors, dob: '' });
                  }}
                />
                <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
              {errors.dob && <p className="text-[10px] text-red-500 mt-1">{errors.dob}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Government ID type</label>
              <div className="relative">
                <select 
                  className={`w-full border rounded-lg px-4 py-3 text-sm outline-none appearance-none bg-white focus:ring-1 ${errors.idType ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`}
                  value={formData.idType || ''}
                  onChange={(e) => {
                    setFormData({ ...formData, idType: e.target.value });
                    if (errors.idType) setErrors({ ...errors, idType: '' });
                  }}
                >
                  <option value="">Select type</option>
                  <option value="National ID">National ID Card</option>
                  <option value="Driver License">Driver's License</option>
                  <option value="International Passport">International Passport</option>
                  <option value="Voters Card">Voter's Card</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              </div>
              {errors.idType && <p className="text-[10px] text-red-500 mt-1">{errors.idType}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center bg-gray-50/30 cursor-pointer hover:bg-gray-50 transition-colors ${errors.governmentId ? 'border-red-300' : 'border-gray-200'}`}>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFiles({ ...files, governmentId: file });
                      if (errors.governmentId) setErrors({ ...errors, governmentId: '' });
                    }
                  }}
                />
                <div className={`p-2 rounded-full mb-2 ${files.governmentId ? 'bg-green-500' : 'bg-[#4E37FB]'}`}>
                  {files.governmentId ? <CheckCircle className="h-4 w-4 text-white" /> : <Plus className="h-4 w-4 text-white" />}
                </div>
                <p className="text-[#4E37FB] font-bold text-[10px] mb-1 text-center">
                  {files.governmentId ? 'ID Uploaded' : 'Government ID'}
                </p>
                <p className="text-[8px] text-gray-400 line-clamp-1 text-center">
                  {files.governmentId ? files.governmentId.name : 'Click to upload'}
                </p>
              </label>

              <label className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center bg-gray-50/30 cursor-pointer hover:bg-gray-50 transition-colors ${errors.selfie ? 'border-red-300' : 'border-gray-200'}`}>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFiles({ ...files, selfie: file });
                      if (errors.selfie) setErrors({ ...errors, selfie: '' });
                    }
                  }}
                />
                <div className={`p-2 rounded-full mb-2 ${files.selfie ? 'bg-green-500' : 'bg-[#4E37FB]'}`}>
                  {files.selfie ? <CheckCircle className="h-4 w-4 text-white" /> : <Plus className="h-4 w-4 text-white" />}
                </div>
                <p className="text-[#4E37FB] font-bold text-[10px] mb-1 text-center">
                  {files.selfie ? 'Selfie Uploaded' : 'Selfie / Face Match'}
                </p>
                <p className="text-[8px] text-gray-400 line-clamp-1 text-center">
                  {files.selfie ? files.selfie.name : 'Click to upload'}
                </p>
              </label>
            </div>
            {(errors.governmentId || errors.selfie) && (
              <p className="text-[10px] text-red-500 text-center">Please upload both required documents</p>
            )}
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Business registration number (RC/BN)</label>
              <input 
                type="text" 
                className={`w-full border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 ${errors.rcNumber ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`} 
                placeholder="Enter registration number" 
                value={formData.rcNumber || ''}
                onChange={(e) => {
                  setFormData({ ...formData, rcNumber: e.target.value });
                  if (errors.rcNumber) setErrors({ ...errors, rcNumber: '' });
                }}
              />
              {errors.rcNumber && <p className="text-[10px] text-red-500 mt-1">{errors.rcNumber}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Director's Full Name</label>
              <input 
                type="text" 
                className={`w-full border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 ${errors.directorName ? 'border-red-500 ring-red-500' : 'focus:ring-indigo-500'}`} 
                placeholder="Enter director's name" 
                value={formData.directorName || ''}
                onChange={(e) => {
                  setFormData({ ...formData, directorName: e.target.value });
                  if (errors.directorName) setErrors({ ...errors, directorName: '' });
                }}
              />
              {errors.directorName && <p className="text-[10px] text-red-500 mt-1">{errors.directorName}</p>}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <label className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center bg-gray-50/30 cursor-pointer hover:bg-gray-50 transition-colors ${errors.proofOfAddress ? 'border-red-300' : 'border-gray-200'}`}>
                <input 
                  type="file" 
                  className="hidden" 
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFiles({ ...files, proofOfAddress: file });
                      if (errors.proofOfAddress) setErrors({ ...errors, proofOfAddress: '' });
                    }
                  }}
                />
                <div className={`p-2 rounded-full mb-2 ${files.proofOfAddress ? 'bg-green-500' : 'bg-[#4E37FB]'}`}>
                  {files.proofOfAddress ? <CheckCircle className="h-4 w-4 text-white" /> : <Upload className="h-4 w-4 text-white" />}
                </div>
                <p className="text-[#4E37FB] font-bold text-[10px] mb-1 text-center">
                  {files.proofOfAddress ? 'Address Proof' : 'Proof of Address'}
                </p>
                <p className="text-[8px] text-gray-400 line-clamp-1 text-center">
                  {files.proofOfAddress ? files.proofOfAddress.name : 'Utility bill/Bank statement'}
                </p>
              </label>

              <label className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center bg-gray-50/30 cursor-pointer hover:bg-gray-50 transition-colors ${errors.businessCert ? 'border-red-300' : 'border-gray-200'}`}>
                <input 
                  type="file" 
                  className="hidden" 
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFiles({ ...files, businessCert: file });
                      if (errors.businessCert) setErrors({ ...errors, businessCert: '' });
                    }
                  }}
                />
                <div className={`p-2 rounded-full mb-2 ${files.businessCert ? 'bg-green-500' : 'bg-[#4E37FB]'}`}>
                  {files.businessCert ? <CheckCircle className="h-4 w-4 text-white" /> : <Upload className="h-4 w-4 text-white" />}
                </div>
                <p className="text-[#4E37FB] font-bold text-[10px] mb-1 text-center">
                  {files.businessCert ? 'Business Cert' : 'Business Certificate'}
                </p>
                <p className="text-[8px] text-gray-400 line-clamp-1 text-center">
                  {files.businessCert ? files.businessCert.name : 'CAC Certificate / Registration'}
                </p>
              </label>
            </div>
            {(errors.proofOfAddress || errors.businessCert) && (
              <p className="text-[10px] text-red-500 text-center">Please upload both required documents</p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-white w-full max-w-[440px] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            Upgrade wallet to {tiers.find(t => t.level === tier)?.title || `Tier ${tier}`}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6 max-h-[60vh] overflow-y-auto hide-scrollbar">
          {renderFields()}

          {/* Summary Section */}
          <div className="bg-[#FAF9FF] rounded-lg p-5 space-y-3">
            {(() => {
              const selectedTier = tiers.find(t => t.level === tier);
              const feeStr = selectedTier?.level === 1 ? '₦1,000' : (selectedTier?.level === 2 ? '₦5,000' : '₦20,000');
              const fee = parseInt(feeStr.replace(/[^0-9]/g, '')) || 0;
              const gatewayFee = 50;
              const total = fee + gatewayFee;
              
              return (
                <>
                  <h4 className="text-xs font-bold text-gray-900 mb-1">Summary</h4>
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500">Upgrade fee ({selectedTier?.title})</span>
                    <span className="text-gray-900 font-bold">₦{fee.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500">Gateway fee</span>
                    <span className="text-gray-900 font-bold">₦{gatewayFee.toLocaleString()}</span>
                  </div>
                  <div className="border-t pt-3 flex justify-between text-xs font-medium">
                    <span className="text-gray-500">Total to pay</span>
                    <span className="text-[#000000] font-black text-sm">₦{total.toLocaleString()}</span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-6 border-t flex flex-col items-center gap-2 mt-2 bg-white">
          <button 
            className="w-full max-w-[200px] bg-[#4E37FB] text-white py-3 rounded-lg font-bold text-sm hover:bg-[#3d2dd8] transition-all transform active:scale-95 shadow-md disabled:opacity-50"
            onClick={async () => {
              if (!validateForm()) return;
              
              try {
                setLoading(true);
                const apiFormData = new FormData();
                apiFormData.append('targetLevel', String(tier));
                apiFormData.append('metadata', JSON.stringify(formData));
                
                Object.keys(files).forEach(key => {
                  apiFormData.append(key, files[key]);
                });

                const token = localStorage.getItem('token') || (typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || '{}').token : null);
                
                const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/wallet/upgrade`, {
                  method: 'POST',
                  headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                  },
                  body: apiFormData
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.message || 'Submission failed');
                
                onSuccess();
              } catch (err: any) {
                alert(err.message);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? 'Submitting...' : 'Confirm Upgrade'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Success Modal Component
interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SuccessModal = ({ isOpen, onClose }: SuccessModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-white w-full max-w-[400px] rounded-2xl shadow-2xl p-8 flex flex-col items-center text-center animate-in fade-in zoom-in duration-300">
        <div className="w-16 h-16 bg-[#E7F9F0] rounded-full flex items-center justify-center mb-6">
          <div className="w-12 h-12 bg-[#F1FCF6] rounded-full flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-[#12B76A]" />
          </div>
        </div>
        
        <h2 className="text-xl font-bold text-[#101828] mb-3">Your upgrade request submitted</h2>
        <p className="text-sm text-[#475467] leading-relaxed mb-8 px-4">
          You have submitted an upgrade request, it will be reviewed and feedback would be given in 48 hours
        </p>
        
        <button 
          onClick={onClose}
          className="w-full py-3 px-4 border border-[#D0D5DD] rounded-xl text-sm font-bold text-[#344054] hover:bg-gray-50 transition-all active:scale-95 shadow-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
};