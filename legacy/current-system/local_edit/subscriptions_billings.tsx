"use client"
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import adminAPI from '@/app/admin/utilis/adminApi';

interface SubscriptionsProps {
  merchantId: string;
}

const planNames: Record<number, string> = {
  1: 'Starter Pack (1–3 agents)',
  2: 'Growth Pack (4–6 agents)',
  3: 'Mid-level Pack (7–10 agents)',
  4: 'Large Pack (11–20 agents)',
  5: 'Enterprise Pack (21+ agents)',
};

const formatNaira = (amount: number | string | null | undefined) => {
  const val = parseFloat(String(amount || 0));
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(val);
};

const formatDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
};

const statusColor = (status: string) => {
  switch (status) {
    case 'Active': return 'text-green-600 bg-green-50';
    case 'Blocked': return 'text-red-600 bg-red-50';
    case 'Grace': return 'text-yellow-600 bg-yellow-50';
    case 'Suspended': return 'text-orange-600 bg-orange-50';
    default: return 'text-gray-600 bg-gray-50';
  }
};

const Subscriptions_Billings = ({ merchantId }: SubscriptionsProps) => {
  const queryClient = useQueryClient();
  const [customFee, setCustomFee] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [editing, setEditing] = useState(false);

  const { data: subscriptionData, isLoading } = useQuery({
    queryKey: ['merchantSubscriptions', merchantId],
    queryFn: () => adminAPI.getMerchantSubscriptions(Number(merchantId)),
  });

  const subscription = subscriptionData?.data;

  const updateCustomFee = useMutation({
    mutationFn: () =>
      adminAPI.updateMerchant(Number(merchantId), {
        isCustomFee: isCustom,
        customFee: isCustom ? parseFloat(customFee) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchantSubscriptions', merchantId] });
      setEditing(false);
    },
  });

  if (isLoading) {
    return (
      <div className="py-12 text-center text-gray-400 font-inter">
        Loading subscription data...
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="py-12 text-center text-gray-400 font-inter">
        No subscription data available
      </div>
    );
  }

  const inTrial = subscription.trialEndDate && new Date(subscription.trialEndDate) > new Date();

  return (
    <div className="bg-white shadow-sm w-full p-5 font-inter">
      <h2 className="text-[18px] font-semibold mb-5">Subscription &amp; Billing</h2>

      {/* Status Banner */}
      {inTrial && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">
          🎁 This merchant is on a <strong>free trial</strong> until{' '}
          <strong>{formatDate(subscription.trialEndDate)}</strong>.
        </div>
      )}

      {parseFloat(subscription.totalDebt) > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          ⚠️ Outstanding debt: <strong>{formatNaira(subscription.totalDebt)}</strong>. Dashboard access may be blocked.
        </div>
      )}

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Subscription Status', value: subscription.status, badge: true },
          { label: 'Current Plan', value: typeof subscription.currentPlan === 'number' ? planNames[subscription.currentPlan] || 'Custom' : subscription.currentPlan || 'Starter Pack' },
          { label: 'Billing Cycle', value: 'Monthly (30 days)' },
          { label: 'Next Billing Date', value: formatDate(subscription.nextBillingDate) },
          { label: 'Trial Ends', value: formatDate(subscription.trialEndDate) },
          { label: 'Outstanding Debt', value: formatNaira(subscription.totalDebt) },
        ].map((item) => (
          <div key={item.label} className="border rounded-lg p-4">
            <p className="text-[#93979F] text-[12px] mb-1">{item.label}</p>
            {item.badge ? (
              <span className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${statusColor(item.value as string)}`}>
                {item.value}
              </span>
            ) : (
              <h3 className="font-semibold text-[15px]">{item.value}</h3>
            )}
          </div>
        ))}
      </div>

      {/* Custom Fee Section */}
      <div className="border rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[15px]">Fee Override (Super Admin)</h3>
          {!editing ? (
            <button
              onClick={() => {
                setIsCustom(subscription.isCustomFee);
                setCustomFee(subscription.customFee ? String(subscription.customFee) : '');
                setEditing(true);
              }}
              className="text-sm text-[#4E37FB] font-semibold hover:underline"
            >
              Edit
            </button>
          ) : null}
        </div>

        {editing ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isCustom}
                onChange={(e) => setIsCustom(e.target.checked)}
                className="h-4 w-4 accent-[#4E37FB]"
              />
              Use custom fee instead of standard plan pricing
            </label>
            {isCustom && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Custom Amount (₦)</label>
                <input
                  type="number"
                  value={customFee}
                  onChange={(e) => setCustomFee(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full max-w-[200px]"
                  placeholder="e.g. 25000"
                />
              </div>
            )}
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => updateCustomFee.mutate()}
                disabled={updateCustomFee.isPending}
                className="bg-[#4E37FB] text-white text-sm px-4 py-2 rounded font-semibold disabled:opacity-60"
              >
                {updateCustomFee.isPending ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:underline">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">
            {subscription.isCustomFee
              ? `Custom fee active: ${formatNaira(subscription.customFee)}/month`
              : 'Using standard plan pricing based on agent count'}
          </div>
        )}
      </div>

      {/* Billing History placeholder */}
      <div>
        <h3 className="text-[15px] font-semibold mb-3">Billing History</h3>
        <div className="border rounded-lg p-6 text-center text-gray-400 text-sm">
          Billing history will appear here once charges are generated.
        </div>
      </div>
    </div>
  );
};

export default Subscriptions_Billings;