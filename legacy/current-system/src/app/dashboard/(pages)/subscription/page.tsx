"use client"
import React, { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { BASE_URL } from '../../../../../services/api';

const SubscriptionPage = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [reactivateMsg, setReactivateMsg] = useState<string | null>(null);

  const getToken = () => {
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!userStr) return null;
    try {
      const userObj = JSON.parse(userStr);
      return userObj.token || userObj.accessToken || null;
    } catch {
      return null;
    }
  };

  const fetchSubscription = () => {
    const token = getToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }

    setLoading(true);
    setError(null);
    fetch(`${BASE_URL}/merchant/subscription`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          localStorage.removeItem('user');
          window.location.href = '/login';
          throw new Error('Session expired');
        }
        return r.json();
      })
      .then(d => {
        if (d.success) {
          setData(d.data);
        } else {
          setError(d.message || 'Failed to load subscription data.');
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err.message !== 'Session expired') {
          setError('Network error. Please try again.');
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

  const handleReactivate = async () => {
    const token = getToken();
    if (!token) { window.location.href = '/login'; return; }

    setReactivating(true);
    setReactivateMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/merchant/reactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const d = await res.json();
      if (d.success) {
        setReactivateMsg('✅ Subscription reactivated! Your next billing date has been updated.');
        fetchSubscription();
      } else {
        setReactivateMsg(`❌ ${d.message || 'Failed to reactivate subscription.'}`);
      }
    } catch {
      setReactivateMsg('❌ Network error. Please try again.');
    } finally {
      setReactivating(false);
    }
  };

  const formatNaira = (v: any) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(parseFloat(v || 0));

  const formatDate = (d: any) => d ? new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

  const merchant = data?.merchant;
  const history = data?.history || [];

  const rawStatus = merchant?.subscription_status || merchant?.subscriptionStatus || 'Active';
  const isExpired = rawStatus === 'Suspended' || rawStatus === 'Blocked' ||
    (merchant?.next_billing_date && new Date() > new Date(merchant.next_billing_date) && rawStatus !== 'Active');
  const displayStatus = isExpired ? 'Expired' : (rawStatus === 'Grace' ? 'Grace Period' : rawStatus);
  const statusColor = displayStatus === 'Active' ? 'text-green-600' : displayStatus === 'Grace Period' ? 'text-yellow-600' : 'text-red-600';
  const statusBadgeBg = displayStatus === 'Active' ? 'bg-green-50 border-green-200' : displayStatus === 'Grace Period' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Subscription & Billing</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <Download size={14} />
            Print PDF
          </button>
          {data && (
            <div className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-500">
               {data?.agentCount || 0} Agents
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 py-12 text-center flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
            Loading subscription data...
        </div>
      ) : error ? (
        <div className="text-red-500 py-12 text-center">{error}</div>
      ) : !merchant ? (
        <div className="text-gray-400 py-12 text-center">Could not load subscription data.</div>
      ) : (
        <div className="space-y-6">

          {/* Expired / Suspended Banner */}
          {isExpired && (
            <div className={`rounded-xl border p-5 ${statusBadgeBg}`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <p className="font-semibold text-red-700 text-base">⚠️ Subscription Expired</p>
                  <p className="text-sm text-red-600 mt-1">
                    Your subscription expired on <strong>{formatDate(merchant.next_billing_date)}</strong>.
                    You cannot add new records until you reactivate.
                    The plan cost (₦{parseFloat(merchant?.plan?.pricing || 5000).toLocaleString()}) will be deducted from your wallet.
                  </p>
                </div>
                <button
                  onClick={handleReactivate}
                  disabled={reactivating}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 shrink-0"
                >
                  <RefreshCw size={14} className={reactivating ? 'animate-spin' : ''} />
                  {reactivating ? 'Reactivating...' : 'Reactivate Now'}
                </button>
              </div>
              {reactivateMsg && (
                <p className="mt-3 text-sm text-gray-700 font-medium">{reactivateMsg}</p>
              )}
            </div>
          )}

          {/* Active Trial Banner */}
          {!isExpired && merchant.trial_end_date && new Date(merchant.trial_end_date) > new Date() && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-indigo-700">
              🎁 You are on a <strong>free trial</strong> until <strong>{formatDate(merchant.trial_end_date)}</strong>.
              Enjoy full access!
            </div>
          )}

          {/* Outstanding Debt Banner */}
          {parseFloat(merchant.total_debt) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 flex items-center justify-between">
              <div>
                ⚠️ Outstanding balance: <strong>{formatNaira(merchant.total_debt)}</strong>.
                Please fund your wallet to avoid service interruption.
              </div>
              <button
                onClick={() => window.location.href='/dashboard/wallet'}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Fund Wallet
              </button>
            </div>
          )}

          {/* Stats Grid */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { label: 'Status', value: displayStatus, color: statusColor },
                { label: 'Current Plan', value: merchant.plan ? `${merchant.plan.name} (₦${parseFloat(merchant.plan.pricing || 0).toLocaleString()})` : 'Starter Pack' },
                { label: 'Billing Cycle', value: 'Monthly (30 days)' },
                { label: 'Next Billing Date', value: formatDate(merchant.nextBillingDate || merchant.next_billing_date) },
                ...(merchant.trial_end_date && new Date(merchant.trial_end_date) > new Date() ? [
                  { label: 'Trial Ends', value: formatDate(merchant.trialEndDate || merchant.trial_end_date) }
                ] : []),
                { label: 'Outstanding Debt', value: formatNaira(merchant.totalDebt || merchant.total_debt) },
              ].map(item => (
                <div key={item.label} className="flex flex-col">
                  <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                  <p className={`font-semibold text-[15px] ${(item as any).color || 'text-gray-900'}`}>{item.value ?? '—'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Billing History */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h2 className="font-semibold text-[16px] mb-4">Billing History</h2>
            {history.length > 0 ? (
               <div className="overflow-x-auto">
                 <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-gray-400 font-medium">
                        <th className="pb-3">Date</th>
                        <th className="pb-3">Plan</th>
                        <th className="pb-3">Amount</th>
                        <th className="pb-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h: any) => (
                        <tr key={h.id} className="border-b last:border-0">
                          <td className="py-4">{formatDate(h.createdAt)}</td>
                          <td className="py-4 font-medium">{h.plan?.name || 'Standard'}</td>
                          <td className="py-4">{formatNaira(h.amount)}</td>
                          <td className="py-4">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${h.status === 'Paid' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                              {h.status?.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                 </table>
               </div>
            ) : (
                <p className="text-gray-400 text-sm text-center py-6">
                  Your billing history will appear here once charges are generated.
                </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionPage;
