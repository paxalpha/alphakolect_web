"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  fetchCustomerById,
  fetchCustomerWallets,
  fetchChargeHistory,
  fetchLoans,
  fetchLoanApplications,
  fetchRepayments,
  fetchInvestmentApplications,
  fetchInvestmentTransactions,
  fetchCollections,
  createCollection,
  createWalletTransaction,
  updateLoanApplicationStatus,
  updateInvestmentApplicationStatus,
  assignCharge,
  updateChargeAssignmentStatus,
  updateCustomer,
  fetchCharges,
  fetchPackages,
  transferToCustomer,
  fetchAgents,
  fetchBranches,
  fetchCustomerWalletTransactions
} from '../../../../../services/api'
import Swal from 'sweetalert2'

type TabKey = 'collection' | 'loan' | 'investment' | 'charges' | 'wallet'

export default function CustomerDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = useMemo(() => Number(params?.id), [params])

  const [active, setActive] = useState<TabKey>('collection')
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [customer, setCustomer] = useState<any | null>(null)
  const [walletStats, setWalletStats] = useState<any | null>(null)
  const [collections, setCollections] = useState<any[]>([])
  const [walletTransactions, setWalletTransactions] = useState<any[]>([])
  const [loans, setLoans] = useState<any[]>([])
  const [loanApplications, setLoanApplications] = useState<any[]>([])
  const [repayments, setRepayments] = useState<any[]>([])
  const [investments, setInvestments] = useState<any[]>([])
  const [investmentTransactions, setInvestmentTransactions] = useState<any[]>([])
  const [charges, setCharges] = useState<any[]>([])
  const [customerPackage, setCustomerPackage] = useState<any | null>(null)

  const loadAll = async () => {
    if (!customerId) return
    try {
      setLoading(true)
      setError(null)

      const [customerResp, packagesResp, agentsResp, branchesResp, chargesResp] = await Promise.all([
        fetchCustomerById(customerId).catch(() => null),
        fetchPackages().catch(() => []),
        fetchAgents().catch(() => []),
        fetchBranches().catch(() => []),
        fetchCharges().catch(() => null)
      ])
      
      const fetchedCustomer = customerResp?.customer || customerResp
      const allPackages = packagesResp?.packages || packagesResp?.data || packagesResp || []
      setPackages(allPackages)
      setAgents(agentsResp?.agents || agentsResp?.data || agentsResp || [])
      setBranches(branchesResp?.branches || branchesResp?.data || branchesResp || [])
      setAvailableCharges(chargesResp?.charges || chargesResp || [])

      if (fetchedCustomer?.packageId) {
        const pkg = allPackages.find((p: any) => p.id === fetchedCustomer.packageId)
        setCustomerPackage(pkg || null)
      } else {
        setCustomerPackage(null)
      }

      let fetchedWallet = null
      if (fetchedCustomer) {
        setEditFormData({
          fullName: fetchedCustomer.fullName || fetchedCustomer.name || '',
          email: fetchedCustomer.email || '',
          phoneNumber: fetchedCustomer.phoneNumber || '',
          address: fetchedCustomer.address || '',
          packageId: String(fetchedCustomer.packageId || ''),
          agentId: String(fetchedCustomer.agentId || ''),
          branchId: String(fetchedCustomer.branchId || '')
        })

        const walletsRes = await fetchCustomerWallets({ customerId }).catch(() => null)
        const walletList = walletsRes?.wallets || walletsRes?.data || walletsRes || []
        if (walletList.length > 0) {
          fetchedWallet = walletList[0]
        }
      }

      setCustomer(fetchedCustomer)
      setWalletStats(fetchedWallet)

      const searchTerm = fetchedCustomer?.accountNumber || fetchedCustomer?.fullName || ''
      const [colRes, loanRes, loanAppRes, repayRes, invAppRes, invTxRes, chgRes, walletTxRes] = await Promise.all([
        fetchCollections({ customerId: String(customerId) }).catch(() => []),
        fetchLoans({ customerId: String(customerId), limit: 100 }).catch(() => []),
        fetchLoanApplications({ customerId: String(customerId), search: searchTerm, limit: 100 }).catch(() => []),
        fetchRepayments({ customerId: String(customerId), search: searchTerm, limit: 100 }).catch(() => []),
        fetchInvestmentApplications({ customerId: String(customerId), search: searchTerm, limit: 100 }).catch(() => []),
        fetchInvestmentTransactions({ customerId: String(customerId), search: searchTerm, limit: 100 }).catch(() => []),
        fetchChargeHistory({ customerId }).catch(() => []),
        fetchCustomerWalletTransactions(customerId).catch(() => [])
      ])
      
      const idStr = String(customerId)
      const normalize = (res: any): any[] => {
        if (Array.isArray(res)) return res
        if (Array.isArray(res?.data)) return res.data
        if (Array.isArray(res?.rows)) return res.rows
        if (Array.isArray(res?.list)) return res.list
        if (Array.isArray(res?.applications)) return res.applications
        if (Array.isArray(res?.collections)) return res.collections
        if (Array.isArray(res?.data?.collections)) return res.data.collections
        if (Array.isArray(res?.transactions)) return res.transactions
        if (Array.isArray(res?.history)) return res.history
        if (Array.isArray(res?.repayments)) return res.repayments
        return []
      }

      const filterByCustomer = (res: any): any[] => {
        const arr = normalize(res)
        return arr.filter((item: any) =>
          item.customerId === customerId ||
          item.customer_id === customerId ||
          String(item.customerId) === idStr ||
          String(item.customer_id) === idStr ||
          item.customerName === fetchedCustomer?.fullName ||
          item.customerName === fetchedCustomer?.name ||
          item.accountNumber === fetchedCustomer?.accountNumber
        )
      }

      const collectionsData = filterByCustomer(colRes)
      const loanAppsData = filterByCustomer(loanAppRes)
      const loansData = filterByCustomer(loanRes)
      const repaymentsData = filterByCustomer(repayRes)
      const investmentAppsData = filterByCustomer(invAppRes)
      const investmentTxData = filterByCustomer(invTxRes)
      const chargesData = filterByCustomer(chgRes)

      setWalletStats(fetchedWallet)

      setCollections(collectionsData)
      setLoanApplications(loanAppsData)
      setLoans([...loansData, ...repaymentsData.map((r: any) => ({ ...r, type: 'Repayment', packageName: r.loanPackage || 'Loan Repayment' }))])
      setRepayments(repaymentsData)
      setInvestments([...investmentAppsData, ...investmentTxData.map((t: any) => ({ ...t, type: t.transactionType || 'Transaction' }))])
      setInvestmentTransactions(investmentTxData)
      setCharges(chargesData)

      // Derive wallet transactions if no dedicated endpoint data exists
      let derivedTxs = normalize(walletTxRes)
      if (derivedTxs.length === 0) {
        // Build from investments & payment gateway transactions (collections are excluded as they belong to Collection Wallet)
        const invTxs = investmentTxData.map((i: any) => ({
          id: `inv-${i.id}`,
          date: i.transactionDate || i.created_at,
          type: i.transactionType || 'Investment',
          description: i.notes || `Investment ${i.package || 'transaction'}`,
          amount: i.amount,
          direction: i.transactionType === 'withdrawal' ? 'out' : 'in'
        }))

        derivedTxs = [...invTxs].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        )
      }
      
      setWalletTransactions(derivedTxs)
      
      console.log('Customer Details Loaded:', { 
        customer: fetchedCustomer, 
        wallet: fetchedWallet,
        collectionsCount: collectionsData.length,
        walletTxsCount: derivedTxs.length
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to load customer details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const [amount, setAmount] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash')
  const [withdrawAmount, setWithdrawAmount] = useState<string>('')
  const [showPostSidebar, setShowPostSidebar] = useState(false)
  const [showWithdrawSidebar, setShowWithdrawSidebar] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showApplyCharge, setShowApplyCharge] = useState(false)
  const [applyChargeAmount, setApplyChargeAmount] = useState('')
  const [applyChargeTitle, setApplyChargeTitle] = useState('')
  const [availableCharges, setAvailableCharges] = useState<any[]>([])
  const [applyChargeDueDate, setApplyChargeDueDate] = useState<string>('')

  const [searchQuery, setSearchQuery] = useState('')

  const [showEditCustomer, setShowEditCustomer] = useState(false)
  const [showReassign, setShowReassign] = useState(false)
  
  const [editFormData, setEditFormData] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    address: '',
    packageId: '',
    agentId: '',
    branchId: ''
  })
  const [packages, setPackages] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [withdrawType, setWithdrawType] = useState<'Cash' | 'Loan'>('Cash')
  
  const filteredCollections = useMemo(() => {
    if (!Array.isArray(collections)) return []
    let data = collections;
    
    // Time filter
    if (timeRange !== 'all') {
      const now = new Date();
      let threshold = new Date();
      if (timeRange === 'day') threshold.setHours(0,0,0,0);
      else if (timeRange === 'week') threshold.setDate(now.getDate() - 7);
      else if (timeRange === 'month') threshold.setMonth(now.getMonth() - 1);
      data = data.filter(c => new Date(c.collectedDate || c.dateCreated || c.date) >= threshold);
    }

    if (!searchQuery) return data
    return data.filter((c: any) => 
      String(c.reference || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(c.type || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(c.packageName || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [collections, searchQuery, timeRange])

  const filteredLoans = useMemo(() => {
    const combined = [
      ...loanApplications.map((a: any) => ({ ...a, recordType: 'application' })),
      ...loans.map((l: any) => ({ ...l, recordType: l.type === 'Repayment' ? 'repayment' : 'loan' }))
    ]
    let data = combined;

    if (timeRange !== 'all') {
      const now = new Date();
      let threshold = new Date();
      if (timeRange === 'day') threshold.setHours(0,0,0,0);
      else if (timeRange === 'week') threshold.setDate(now.getDate() - 7);
      else if (timeRange === 'month') threshold.setMonth(now.getMonth() - 1);
      data = data.filter(l => new Date(l.dateIssued || l.paymentDate || l.createdAt || l.dateApplied) >= threshold);
    }

    if (!searchQuery) return data
    return data.filter((l: any) => 
      String(l.reference || l.id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(l.packageName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(l.status || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [loans, loanApplications, searchQuery, timeRange])

  const filteredInvestments = useMemo(() => {
    if (!Array.isArray(investments)) return []
    let data = investments;

    // Time filter
    if (timeRange !== 'all') {
      const now = new Date();
      let threshold = new Date();
      if (timeRange === 'day') threshold.setHours(0,0,0,0);
      else if (timeRange === 'week') threshold.setDate(now.getDate() - 7);
      else if (timeRange === 'month') threshold.setMonth(now.getMonth() - 1);
      data = data.filter(i => new Date(i.transactionDate || i.createdAt || i.created_at) >= threshold);
    }

    if (!searchQuery) return data
    return data.filter((i: any) => 
      String(i.id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(i.packageName || i.plan || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(i.status || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [investments, searchQuery, timeRange])

  const filteredWalletTransactions = useMemo(() => {
    if (!Array.isArray(walletTransactions)) return []
    let data = walletTransactions;

    // Time filter
    if (timeRange !== 'all') {
      const now = new Date();
      let threshold = new Date();
      if (timeRange === 'day') threshold.setHours(0,0,0,0);
      else if (timeRange === 'week') threshold.setDate(now.getDate() - 7);
      else if (timeRange === 'month') threshold.setMonth(now.getMonth() - 1);
      data = data.filter(t => new Date(t.date || t.createdAt || t.transactionDate) >= threshold);
    }

    if (!searchQuery) return data
    return data.filter((t: any) => 
      String(t.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(t.type || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [walletTransactions, searchQuery, timeRange])

  const handlePostToCollection = async () => {
    if (!customerId || !amount) return
    setLoading(true)
    try {
      await createCollection({ 
        customerName: customer?.fullName || customer?.name || String(customerId), 
        amount: Number(amount), 
        dueDate: new Date().toISOString(), 
        type: paymentMethod,
        packageName: customerPackage?.name || customer?.packageName,
        packageAmount: customerPackage?.amount || customer?.collectionAmount,
        customerId: customerId,
        postToCollection: true
      } as any)
      Swal.fire('Success', 'Collection posted successfully', 'success')
      setAmount('')
      setShowPostSidebar(false)
      await loadAll()
    } catch (e: any) {
      Swal.fire('Error', e.message || 'Failed to post collection', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleWithdraw = async () => {
    if (!customerId || !withdrawAmount) return
    setLoading(true)
    try {
      if (withdrawType === 'Cash') {
        await createWalletTransaction({ 
          type: 'debit', 
          amount: Number(withdrawAmount), 
          description: `Withdrawal for customer ${customer?.fullName || customerId}` 
        })
      } else {
        // Withdraw to Loan
        await transferToCustomer({
          customerId: customerId,
          amount: Number(withdrawAmount),
          description: `Move funds from Collection/Live to Loan Wallet`,
          type: 'debit',
          transactionType: 'loan_funding'
        })
      }
      await loadAll()
      setShowWithdrawSidebar(false)
      setWithdrawAmount('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleApproveLoan = async (loanId: number) => {
    setLoading(true)
    try {
      await updateLoanApplicationStatus(loanId, { status: 'Approved' })
      await loadAll()
    } finally { setLoading(false) }
  }

  const handleRejectLoan = async (loanId: number) => {
    setLoading(true)
    try {
      await updateLoanApplicationStatus(loanId, { status: 'Rejected' })
      await loadAll()
    } finally { setLoading(false) }
  }

  const handleApproveInvestment = async (id: number) => {
    setLoading(true)
    try {
      await updateInvestmentApplicationStatus(id, { status: 'Approved' })
      await loadAll()
    } finally { setLoading(false) }
  }

  const handleRejectInvestment = async (id: number) => {
    setLoading(true)
    try {
      await updateInvestmentApplicationStatus(id, { status: 'Rejected' })
      await loadAll()
    } finally { setLoading(false) }
  }

  const handleApplyCharge = async () => {
    if (!customerId || !applyChargeAmount || !applyChargeTitle) {
      Swal.fire('Error', 'Please select a charge first', 'error')
      return
    }
    setLoading(true)
    try {
      const dateToUse = applyChargeDueDate || new Date().toISOString().split('T')[0]
      await assignCharge({ 
        chargeName: applyChargeTitle, 
        amount: applyChargeAmount, 
        dueDate: dateToUse, 
        customer: String(customerId) 
      })
      Swal.fire('Success', 'Charge applied and deducted successfully', 'success')
      await loadAll()
      setShowApplyCharge(false)
      setApplyChargeAmount('')
      setApplyChargeTitle('')
      setApplyChargeDueDate('')
    } catch (e: any) {
      Swal.fire('Error', e.message || 'Failed to apply charge', 'error')
      setError(e.message)
    } finally { setLoading(false) }
  }

  const handleUpdateCustomer = async () => {
    if (!customerId) return
    setLoading(true)
    try {
      await updateCustomer(customerId, editFormData)
      Swal.fire('Success', 'Customer profile updated successfully', 'success')
      await loadAll()
      setShowEditCustomer(false)
      setShowReassign(false)
    } catch (e: any) {
      Swal.fire('Update Failed', e.message || 'Could not update customer', 'error')
      setError(e.message)
    } finally { setLoading(false) }
  }

  const handleExportTab = (tab: TabKey, format: string) => {
    if (format === 'CSV') {
      let headers: string[] = []
      let rows: any[][] = []
      let filename = ''

      if (tab === 'collection') {
        headers = ['Transaction ID', 'Type', 'Package', 'Amount', 'Date', 'Status']
        rows = filteredCollections.map((r, i) => [
          r.reference || r.id || `COL-${i+1}`,
          r.type || 'Collection',
          r.packageName || 'Nil',
          r.amount || 0,
          (r.collectedDate || r.dateCreated || r.date) ? new Date(r.collectedDate || r.dateCreated || r.date).toLocaleDateString() : '',
          r.status || 'Collected'
        ])
        filename = `collections_${customerId}_${new Date().toISOString().split('T')[0]}.csv`
      } else if (tab === 'loan') {
        headers = ['Ref ID', 'Loan Package', 'Amount', 'Status']
        rows = filteredLoans.map((l, i) => [
          l.reference || l.id || `L-${i+1}`,
          l.packageName || 'General Loan',
          l.amount || l.loanAmount || l.requestedAmount || l.repaymentAmount || 0,
          l.status || 'Pending'
        ])
        filename = `loans_${customerId}_${new Date().toISOString().split('T')[0]}.csv`
      } else if (tab === 'investment') {
        headers = ['Ref', 'Plan/Package', 'Amount', 'Status']
        rows = filteredInvestments.map((inv, i) => [
          inv.id || `INV-${i+1}`,
          inv.packageName || inv.package || inv.plan || 'Nil',
          inv.targetAmount || inv.amount || 0,
          inv.status || 'Pending'
        ])
        filename = `investments_${customerId}_${new Date().toISOString().split('T')[0]}.csv`
      } else if (tab === 'charges') {
        headers = ['Charge ID/Ref', 'Amount', 'Status']
        rows = charges.map((c, i) => [
          c.chargeName || c.id || `CHG-${i+1}`,
          c.amount || 0,
          c.status || 'Pending'
        ])
        filename = `charges_${customerId}_${new Date().toISOString().split('T')[0]}.csv`
      }

      if (rows.length === 0) {
        Swal.fire('Info', 'No data to export', 'info')
        return
      }

      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
    } else if (format === 'PDF') {
      window.print()
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 bg-gray-50 min-h-screen font-['Inter']">
      <button onClick={() => router.push('/dashboard/customer')} className="text-indigo-600 text-sm mb-4">‹ Back to customers</button>

      <div className="flex items-start justify-between bg-white border rounded p-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900">{customer?.fullName || 'Customer'}</h1>
          <p className="text-xs text-gray-500 mt-1">Account {customer?.accountNumber || customerId}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEditCustomer(true)} className="px-3 py-2 rounded-md bg-indigo-50 text-indigo-700 text-sm">View/Edit profile</button>
          <button onClick={() => setShowPostSidebar(true)} className="px-3 py-2 rounded-md bg-indigo-700 text-white text-sm">Post to collection</button>
          <div className="relative">
            <button onClick={()=>setMenuOpen((v)=>!v)} className="w-9 h-9 flex items-center justify-center rounded-md border">⋯</button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-white border rounded shadow z-10">
                <button onClick={()=>{setShowEditCustomer(true); setMenuOpen(false);}} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Edit customer</button>
                <button onClick={()=>{setShowApplyCharge(true); setMenuOpen(false);}} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Apply charges</button>
                <button onClick={()=>{setShowReassign(true); setMenuOpen(false);}} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Reassign customer</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <div className="bg-[#F6F5FF] border border-gray-100 rounded p-4">
          <p className="text-xs text-gray-500">Live wallet balance</p>
          <p className="text-lg font-semibold mt-2">₦{Number(walletStats?.balance || 0).toLocaleString()}</p>
        </div>
        <div className="bg-[#FFF8EB] border border-gray-100 rounded p-4">
          <p className="text-xs text-gray-500">Collection wallet balance</p>
          <p className="text-lg font-semibold mt-2">₦{Number(walletStats?.collectionBalance || 0).toLocaleString()}</p>
        </div>
        <div className="bg-[#FFF1F2] border border-gray-100 rounded p-4">
          <p className="text-xs text-gray-500">Loan balance</p>
          <p className="text-lg font-semibold mt-2">₦{Number(walletStats?.loanBalance || walletStats?.loanUnits || 0).toLocaleString()}</p>
        </div>
        <div className="bg-[#FFF8EB] border border-gray-100 rounded p-4">
          <p className="text-xs text-gray-500">Investment balance</p>
          <p className="text-lg font-semibold mt-2">₦{Number(walletStats?.investmentBalance || walletStats?.investments || 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="mt-6 border-b">
        <nav className="flex gap-6 text-sm">
          {(['collection','loan','investment','charges','wallet'] as TabKey[]).map((k) => (
            <button key={k} onClick={() => setActive(k)} className={`pb-3 ${active===k? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-gray-600'}`}>{k === 'wallet' ? 'Live Wallet activity' : k.charAt(0).toUpperCase()+k.slice(1)}</button>
          ))}
        </nav>
      </div>

      {error && <div className="mt-4 p-3 bg-red-50 border text-sm text-red-700">{error}</div>}

      {/* Panels */}
      {active === 'collection' && (
        <div className="mt-6">
          <div className="bg-white rounded border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-6">
                <p className="text-sm font-semibold">Collection details</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    className="bg-[#e9e6ff] text-indigo-600 text-sm rounded px-3 py-2 pr-8 cursor-pointer"
                    defaultValue=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) handleExportTab('collection', val);
                      e.target.value = '';
                    }}
                  >
                    <option value="" disabled>Export</option>
                    <option value="PDF">PDF</option>
                    <option value="CSV">CSV</option>
                  </select>
                </div>
                <button onClick={() => setShowWithdrawSidebar(true)} className="px-3 py-2 rounded border text-sm">Process withdrawal</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-4 py-5">
              <div>
                <p className="text-xs text-gray-500">Package name</p>
                <p className="text-sm mt-1">{customerPackage?.name || collections[0]?.packageName || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Collection days</p>
                <p className="text-sm mt-1">{customerPackage?.collectionDays || customerPackage?.frequency || 'Daily'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">collection Period</p>
                <p className="text-sm mt-1">{customerPackage?.duration ? `${customerPackage.duration} days` : (customerPackage?.period || 'N/A')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Collection amount</p>
                <p className="text-sm mt-1">₦{Number(customerPackage?.amount || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total amount paid</p>
                <p className="text-sm mt-1">₦{Number(collections.reduce((s:any,c:any)=> s + (Number(c.amountCollected || c.amount)||0),0)).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Start date</p>
                <p className="text-sm mt-1">{(() => {
                  const sorted = [...collections].sort((a, b) => new Date(a.dateCreated || a.collectedDate || 0).getTime() - new Date(b.dateCreated || b.collectedDate || 0).getTime())
                  const first = sorted.length > 0 ? new Date(sorted[0].dateCreated || sorted[0].collectedDate) : null
                  return first ? first.toLocaleDateString() : 'N/A'
                })()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">End date</p>
                <p className="text-sm mt-1">{(() => {
                  const sorted = [...collections].sort((a, b) => new Date(a.dateCreated || a.collectedDate || 0).getTime() - new Date(b.dateCreated || b.collectedDate || 0).getTime())
                  const last = sorted.length > 0 ? new Date(sorted[sorted.length-1].dateCreated || sorted[sorted.length-1].collectedDate) : null
                  return last ? last.toLocaleDateString() : 'N/A'
                })()}</p>
              </div>
            </div>
            <div className="flex flex-col md:flex-row items-stretch gap-3 px-4 pb-3">
              <div className="flex items-center gap-2">
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='day'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('day')}>Today</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='week'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('week')}>1 Week</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='month'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('month')}>1 Month</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='all'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('all')}>All</button>
              </div>
              <div className="relative md:ml-auto w-full md:w-80">
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border rounded pl-8 pr-3 py-2 text-sm" 
                  placeholder="Search collections..."
                />
                <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="p-2 text-left">Transaction ID</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Package</th>
                      <th className="p-2 text-left">Amount</th>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCollections.map((r:any, i:number) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{r.reference || r.id || `COL-${i+1}`}</td>
                        <td className="p-2">{r.type || 'Collection'}</td>
                        <td className="p-2">{r.packageName || 'Nil'}</td>
                        <td className="p-2">₦{Number(r.amountCollected || r.amount || 0).toLocaleString()}</td>
                        <td className="p-2">{(r.collectedDate || r.dateCreated || r.date) ? new Date(r.collectedDate || r.dateCreated || r.date).toLocaleDateString() : ''}</td>
                        <td className="p-2 text-green-600">{r.status || 'Collected'}</td>
                      </tr>
                    ))}
                    {filteredCollections.length===0 && <tr><td className="p-2 text-gray-400">No Collection activities</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Charge Deductions from Collection Wallet */}
            {charges.length > 0 && (
              <div className="px-4 pb-4 mt-4">
                <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>
                  Charge Deductions (Collection Wallet)
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="p-2 text-left">Charge Name</th>
                        <th className="p-2 text-left">Amount</th>
                        <th className="p-2 text-left">Date Applied</th>
                        <th className="p-2 text-left">Due Date</th>
                        <th className="p-2 text-left">Status</th>
                        <th className="p-2 text-left">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charges.map((ch: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{ch.chargeName || `CHG-${i + 1}`}</td>
                          <td className="p-2 font-semibold">₦{Number(ch.amount || 0).toLocaleString()}</td>
                          <td className="p-2">{ch.dateApplied || '—'}</td>
                          <td className="p-2">{ch.dueDate || '—'}</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              ch.status === 'Paid' || ch.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>{ch.status || 'Pending'}</span>
                          </td>
                          <td className="p-2 text-red-500 font-medium">out</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {active === 'loan' && (
        <div className="mt-6">
          <div className="bg-white rounded border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-sm font-semibold">Loan activities</p>
                <select
                  className="bg-[#e9e6ff] text-indigo-600 text-sm rounded px-3 py-2 cursor-pointer"
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) handleExportTab('loan', val);
                    e.target.value = '';
                  }}
                >
                  <option value="" disabled>Export</option>
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </select>
            </div>
            
            <div className="flex flex-col md:flex-row items-stretch gap-3 px-4 py-3 bg-gray-50/30">
              <div className="flex items-center gap-2">
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='day'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('day')}>Today</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='week'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('week')}>1 Week</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='month'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('month')}>1 Month</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='all'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('all')}>All</button>
              </div>
              <div className="relative md:ml-auto w-full md:w-80">
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border rounded pl-9 pr-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none" 
                  placeholder="Search loan records..."
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="px-4 py-3 text-left font-medium">Ref ID</th>
                    <th className="px-4 py-3 text-left font-medium">Loan Package</th>
                    <th className="px-4 py-3 text-left font-medium">Amount</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredLoans.map((l:any, i:number) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-900 font-medium">{l.reference || l.id || `L-${i+1}`}</td>
                      <td className="px-4 py-3 text-gray-600">{l.packageName || 'General Loan'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">₦{Number(l.amount||l.loanAmount||l.requestedAmount||l.repaymentAmount||0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                          l.status === 'Approved' ? 'bg-green-100 text-green-700' : 
                          l.status === 'Rejected' ? 'bg-red-100 text-red-700' : 
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {l.status || 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(l.status==='Pending' || !l.status) && (
                          <div className="flex justify-end gap-2">
                            <button 
                              onClick={()=>handleApproveLoan(l.id)} 
                              className="px-2.5 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 transition-colors shadow-sm"
                            >
                              Approve
                            </button>
                            <button 
                              onClick={()=>handleRejectLoan(l.id)} 
                              className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded border border-red-100 text-xs hover:bg-red-100 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredLoans.length===0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-gray-400 italic">
                        No loan records found for this customer.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {active === 'investment' && (
        <div className="mt-6">
          <div className="bg-white rounded border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-sm font-semibold">Investment activities</p>
              <select
                className="bg-[#e9e6ff] text-indigo-600 text-sm rounded px-3 py-2 cursor-pointer"
                defaultValue=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) handleExportTab('investment', val);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>Export</option>
                <option value="PDF">PDF</option>
                <option value="CSV">CSV</option>
              </select>
            </div>
            <div className="flex flex-col md:flex-row items-stretch gap-3 px-4 pb-3 pt-3">
              <div className="flex items-center gap-2">
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='day'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('day')}>Today</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='week'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('week')}>1 Week</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='month'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('month')}>1 Month</button>
                <button className={`px-3 py-1.5 text-xs rounded border ${timeRange==='all'?'bg-indigo-600 text-white':'bg-white text-gray-600'}`} onClick={()=>setTimeRange('all')}>All</button>
              </div>
              <div className="relative md:ml-auto w-full md:w-80">
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border rounded pl-8 pr-3 py-2 text-sm" 
                  placeholder="Search investments..."
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="bg-gray-50 text-gray-500"><th className="p-2 text-left">Ref</th><th className="p-2 text-left">Plan/Package</th><th className="p-2 text-center">Amount</th><th className="p-2 text-center">Status</th></tr></thead>
                <tbody>
                  {filteredInvestments.map((inv:any, i:number) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{inv.id || `INV-${i+1}`}</td>
                      <td className="p-2">{inv.packageName || inv.package || inv.plan || 'Nil'}</td>
                      <td className="p-2 text-center font-medium">₦{Number(inv.targetAmount||inv.amount||0).toLocaleString()}</td>
                      <td className={`p-2 text-center font-medium ${inv.status==='Approved'?'text-green-600':'text-orange-600'}`}>{inv.status || 'Pending'}</td>
                    </tr>
                  ))}
                  {filteredInvestments.length===0 && <tr><td colSpan={4} className="p-6 text-center text-gray-400">No Investment records found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {active === 'charges' && (
        <div className="mt-6">
          <div className="bg-white rounded border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-sm font-semibold">Charges activities</p>
                <select
                  className="bg-[#e9e6ff] text-indigo-600 text-sm rounded px-3 py-2 cursor-pointer"
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) handleExportTab('charges', val);
                    e.target.value = '';
                  }}
                >
                  <option value="" disabled>Export</option>
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </select>
            </div>

            <div className="flex flex-col md:flex-row items-stretch gap-3 px-4 py-3 bg-gray-50/30">
              <button className="flex items-center gap-2 px-3 py-2 border rounded bg-white text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                Filter
              </button>
            </div>

            <div className="overflow-x-auto px-4 pb-4">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="py-3 text-left font-medium">Charge ID/Ref</th>
                    <th className="py-3 text-left font-medium">Amount</th>
                    <th className="py-3 text-left font-medium">Status</th>
                    <th className="py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {charges.map((c:any,i:number)=> (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 text-gray-900 font-medium">{c.chargeName || c.id || `CHG-${i+1}`}</td>
                      <td className="py-3 font-semibold text-gray-900">₦{Number(String(c.amount||0).replace(/[^\d.-]/g,'')||0).toLocaleString()}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                          c.status === 'Paid' || c.status === 'Completed' || c.status === 'Applied' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {c.status || 'Pending'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {(c.status||'Pending')==='Pending' && (
                          <button 
                            onClick={async () => {
                              try {
                                await updateChargeAssignmentStatus(c.id, 'Paid')
                                await loadAll()
                              } catch (e: any) {
                                setError(e.message)
                              }
                            }} 
                            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition-colors shadow-sm"
                          >
                            Pay Charge
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {charges.length===0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-400 italic">
                        No charges found for this customer.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {active === 'wallet' && (
        <div className="mt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="md:w-2/3 bg-white p-4 rounded border">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><p className="text-xs text-gray-500">Level</p><p className="text-sm">{walletStats?.accountLevel || 'Tier 1'}</p></div>
                <div><p className="text-xs text-gray-500">Current balance</p><p className="text-sm">₦{Number(walletStats?.balance||0).toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-500">Account Number</p><p className="text-sm">{walletStats?.accountNumber || customer?.accountNumber || 'Nil'}</p></div>
                <div><p className="text-xs text-gray-500">Bank Name</p><p className="text-sm">{walletStats?.bankName || 'Wema Bank'}</p></div>
              </div>
              <p className="text-sm font-semibold mb-2">Live Wallet activities</p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="text-gray-500"><th className="p-2 text-left">Type</th><th className="p-2 text-left">Description</th><th className="p-2">Amount</th><th className="p-2">Direction</th></tr></thead>
                  <tbody>
                    {filteredWalletTransactions.map((t:any, i:number)=> (
                      <tr key={i} className="border-t">
                        <td className="p-2">{t.type || t.transactionType || 'Transfer'}</td>
                        <td className="p-2">{t.description || t.notes || '-'}</td>
                        <td className="p-2">₦{Number(t.amount||0).toLocaleString()}</td>
                        <td className={`p-2 ${t.direction==='out'||t.type==='debit'?'text-red-500':'text-green-500'}`}>{t.direction || (t.type==='credit'?'Credit':'Debit')}</td>
                      </tr>
                    ))}
                    {filteredWalletTransactions.length === 0 && <tr><td colSpan={4} className="p-2 text-gray-400">No wallet activities</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar: Post to collection */}
      <div className={`fixed inset-0 z-40 ${showPostSidebar ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black transition-opacity ${showPostSidebar ? 'opacity-40' : 'opacity-0'}`}
          onClick={() => setShowPostSidebar(false)}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-xl transform transition-transform ${showPostSidebar ? 'translate-x-0' : 'translate-x-full'}`}
          aria-hidden={!showPostSidebar}
        >
          <div className="flex items-center justify-between p-5 border-b">
            <p className="text-base font-semibold">Post to collection</p>
            <button onClick={()=>setShowPostSidebar(false)} className="text-gray-500">✕</button>
          </div>
          <div className="p-5">
            <label className="text-xs text-gray-700">Amount</label>
            <input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="N 0" className="w-full border rounded px-3 py-2 mt-1"/>
            <label className="text-xs text-gray-700 mt-4 block">Payment method</label>
            <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} className="w-full border rounded px-3 py-2 mt-1">
              <option>Cash</option>
              <option>Transfer</option>
            </select>
          </div>
          <div className="p-5 border-t">
            <button onClick={async()=>{await handlePostToCollection(); setShowPostSidebar(false)}} disabled={loading} className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm">Post to collection</button>
          </div>
        </aside>
      </div>

      {/* Sidebar: Process withdrawal */}
      <div className={`fixed inset-0 z-40 ${showWithdrawSidebar ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black transition-opacity ${showWithdrawSidebar ? 'opacity-40' : 'opacity-0'}`}
          onClick={() => setShowWithdrawSidebar(false)}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-xl transform transition-transform ${showWithdrawSidebar ? 'translate-x-0' : 'translate-x-full'}`}
          aria-hidden={!showWithdrawSidebar}
        >
          <div className="flex items-center justify-between p-5 border-b">
            <p className="text-base font-semibold">Process withdrawal</p>
            <button onClick={()=>setShowWithdrawSidebar(false)} className="text-gray-500">✕</button>
          </div>
          <div className="p-5">
            <label className="text-xs text-gray-700">Withdraw to</label>
            <select 
              value={withdrawType} 
              onChange={(e) => setWithdrawType(e.target.value as any)}
              className="w-full border rounded px-3 py-2 mt-1"
            >
              <option value="Cash">Cash</option>
              <option value="Loan">Loan Wallet</option>
            </select>
            <label className="text-xs text-gray-700 mt-4 block">Amount</label>
            <input value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} placeholder="N 0.0" className="w-full border rounded px-3 py-2 mt-1"/>
          </div>
          <div className="p-5 border-t">
            <button onClick={async()=>{await handleWithdraw(); setShowWithdrawSidebar(false)}} disabled={loading} className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm">Withdraw</button>
          </div>
        </aside>
      </div>

      {/* Sidebar: Apply charges */}
      <div className={`fixed inset-0 z-40 ${showApplyCharge ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black transition-opacity ${showApplyCharge ? 'opacity-40' : 'opacity-0'}`}
          onClick={() => setShowApplyCharge(false)}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-xl transform transition-transform ${showApplyCharge ? 'translate-x-0' : 'translate-x-full'}`}
          aria-hidden={!showApplyCharge}
        >
          <div className="flex items-center justify-between p-5 border-b">
            <p className="text-base font-semibold">Apply charges</p>
            <button onClick={()=>setShowApplyCharge(false)} className="text-gray-500">✕</button>
          </div>
          <div className="p-5">
            <label className="text-xs text-gray-700">Select Charge</label>
            <select
              value={applyChargeTitle}
              onChange={(e) => {
                const title = e.target.value
                setApplyChargeTitle(title)
                const selected = availableCharges.find(c => c.chargeName === title)
                if (selected) {
                  const amt = String(selected.amount).replace(/[^0-9.]/g, '')
                  setApplyChargeAmount(amt)
                } else {
                  setApplyChargeAmount('')
                }
              }}
              className="w-full border rounded px-3 py-2 mt-1 mb-4"
              style={{ outline: 'none' }}
            >
              <option value="">Select charge</option>
              {availableCharges.map((c: any) => (
                <option key={c.id} value={c.chargeName}>
                  {c.chargeName} ({c.amount})
                </option>
              ))}
            </select>
            
            <label className="text-xs text-gray-700">Charge amount</label>
            <input
              value={applyChargeAmount}
              readOnly
              placeholder="N 0"
              className="w-full border rounded px-3 py-2 mt-1 mb-4 bg-gray-50 text-gray-500 cursor-not-allowed"
              style={{ outline: 'none' }}
            />

            <label className="text-xs text-gray-700 block">Due date</label>
            <input
              type="date"
              value={applyChargeDueDate}
              onChange={e => setApplyChargeDueDate(e.target.value)}
              className="w-full border rounded px-3 py-2 mt-1"
              style={{ outline: 'none' }}
            />
          </div>
          <div className="p-5 border-t">
            <button onClick={handleApplyCharge} disabled={loading} className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm">Apply charge</button>
          </div>
        </aside>
      </div>

      {/* Sidebar: Edit Customer */}
      <div className={`fixed inset-0 z-40 ${showEditCustomer ? '' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black transition-opacity ${showEditCustomer ? 'opacity-40' : 'opacity-0'}`} onClick={() => setShowEditCustomer(false)} />
        <aside className={`absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-xl transform transition-transform ${showEditCustomer ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between p-5 border-b">
            <p className="text-base font-semibold">Edit Customer</p>
            <button onClick={()=>setShowEditCustomer(false)} className="text-gray-500">✕</button>
          </div>
          <div className="p-5 space-y-4 overflow-y-auto h-[calc(100%-140px)]">
            <div>
              <label className="text-xs text-gray-700">Full Name</label>
              <input value={editFormData.fullName} onChange={e=>setEditFormData({...editFormData, fullName: e.target.value})} className="w-full border rounded px-3 py-2 mt-1"/>
            </div>
            <div>
              <label className="text-xs text-gray-700">Email</label>
              <input value={editFormData.email} onChange={e=>setEditFormData({...editFormData, email: e.target.value})} className="w-full border rounded px-3 py-2 mt-1"/>
            </div>
            <div>
              <label className="text-xs text-gray-700">Phone Number</label>
              <input value={editFormData.phoneNumber} onChange={e=>setEditFormData({...editFormData, phoneNumber: e.target.value})} className="w-full border rounded px-3 py-2 mt-1"/>
            </div>
            <div>
              <label className="text-xs text-gray-700">Address</label>
              <textarea value={editFormData.address} onChange={e=>setEditFormData({...editFormData, address: e.target.value})} className="w-full border rounded px-3 py-2 mt-1"/>
            </div>
            <div>
              <label className="text-xs text-gray-700">Collection Package</label>
              <select value={editFormData.packageId} onChange={e=>setEditFormData({...editFormData, packageId: e.target.value})} className="w-full border rounded px-3 py-2 mt-1">
                <option value="">Select Package</option>
                {Array.isArray(packages) && packages.map((pkg: any) => (
                  <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="p-5 border-t">
            <button onClick={handleUpdateCustomer} disabled={loading} className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm">Save Changes</button>
          </div>
        </aside>
      </div>

      {/* Sidebar: Reassign Customer */}
      <div className={`fixed inset-0 z-40 ${showReassign ? '' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black transition-opacity ${showReassign ? 'opacity-40' : 'opacity-0'}`} onClick={() => setShowReassign(false)} />
        <aside className={`absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-xl transform transition-transform ${showReassign ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between p-5 border-b">
            <p className="text-base font-semibold">Reassign Customer</p>
            <button onClick={()=>setShowReassign(false)} className="text-gray-500">✕</button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs text-gray-700">Assign to Agent</label>
              <select value={editFormData.agentId} onChange={e=>setEditFormData({...editFormData, agentId: e.target.value})} className="w-full border rounded px-3 py-2 mt-1">
                <option value="">Select Agent</option>
                {Array.isArray(agents) && agents.map((ag: any) => (
                  <option key={ag.id} value={ag.id}>{ag.fullName || ag.name || ag.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-700">Assign to Branch</label>
              <select value={editFormData.branchId} onChange={e=>setEditFormData({...editFormData, branchId: e.target.value})} className="w-full border rounded px-3 py-2 mt-1">
                <option value="">Select Branch</option>
                {Array.isArray(branches) && branches.map((br: any) => (
                  <option key={br.id} value={br.id}>{br.branchName || br.name || br.location}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="p-5 border-t">
            <button onClick={handleUpdateCustomer} disabled={loading} className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm">Update Assignment</button>
          </div>
        </aside>
      </div>
    </div>
  )
}


