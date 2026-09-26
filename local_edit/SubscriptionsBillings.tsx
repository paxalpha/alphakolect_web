"use client";
import React, { useEffect, useState } from "react";
import adminAPI from "@/app/admin/utilis/adminApi";

const PLAN_LABELS: Record<number, string> = {
  1: "Starter Pack (1–3 agents) — ₦5,000/mo",
  2: "Growth Pack (4–6 agents) — ₦10,000/mo",
  3: "Mid-level Pack (7–10 agents) — ₦15,000/mo",
  4: "Large Pack (11–20 agents) — ₦40,000/mo",
  5: "Enterprise Pack (21+ agents) — Custom",
};

const FEE_BY_PLAN: Record<number, number> = {
  1: 5000, 2: 10000, 3: 15000, 4: 40000, 5: 0,
};

const formatNaira = (v: any) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    parseFloat(v || 0)
  );

const formatDate = (d: any) =>
  d ? new Date(d).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" }) : "—";

interface Props { merchantId: string; }

const SubscriptionsBillings: React.FC<Props> = ({ merchantId }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Custom fee form state
  const [isCustomFee, setIsCustomFee] = useState(false);
  const [customFee, setCustomFee] = useState("");

  const load = async () => {
    try {
      const res = await adminAPI.getMerchantSubscriptions(Number(merchantId));
      setData(res.data || res);
      const d = res.data || res;
      setIsCustomFee(d.isCustomFee || false);
      setCustomFee(d.customFee ? String(d.customFee) : "");
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [merchantId]);

  const handleSaveBilling = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await adminAPI.updateMerchant(Number(merchantId), {
        isCustomFee,
        customFee: isCustomFee ? parseFloat(customFee) : null,
      });
      setMsg({ type: "success", text: "Billing settings saved successfully." });
      load();
    } catch {
      setMsg({ type: "error", text: "Failed to save billing settings." });
    }
    setSaving(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
      <div className="animate-spin h-5 w-5 border-b-2 border-indigo-600 rounded-full" />
      Loading billing info...
    </div>
  );

  const agentCount = data?.agentCount || 0;
  const currentPlanId = data?.planId || 1;
  const calculatedFee = isCustomFee ? parseFloat(customFee || "0") : (FEE_BY_PLAN[currentPlanId] || 5000);
  const history: any[] = data?.history || [];

  return (
    <div className="p-6 space-y-6">

      {/* ── Subscription Overview ── */}
      <div className="bg-gray-50 border rounded-xl p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Status", value: data?.status || "Active",
            cls: data?.status === "Active" ? "text-green-600 font-semibold" : "text-red-600 font-semibold" },
          { label: "Current Plan", value: PLAN_LABELS[currentPlanId] || "Starter Pack" },
          { label: "Active Agents", value: agentCount },
          { label: "Calculated Monthly Fee", value: formatNaira(FEE_BY_PLAN[currentPlanId] ?? 5000) },
          { label: "Next Billing Date", value: formatDate(data?.nextBillingDate) },
          { label: "Outstanding Debt", value: formatNaira(data?.totalDebt || 0),
            cls: parseFloat(data?.totalDebt) > 0 ? "text-red-600 font-semibold" : "text-gray-800" },
          { label: "Trial Ends", value: formatDate(data?.trialEndDate) },
        ].map(item => (
          <div key={item.label}>
            <p className="text-xs text-gray-400 mb-0.5">{item.label}</p>
            <p className={`text-sm ${item.cls || "text-gray-800"}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* ── Custom Fee Toggle ── */}
      <div className="bg-white border rounded-xl p-5">
        <h3 className="font-semibold text-[15px] mb-4 text-gray-800">Billing Override</h3>

        <label className="flex items-center gap-3 cursor-pointer mb-4 select-none">
          <div
            onClick={() => { setIsCustomFee(!isCustomFee); setMsg(null); }}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${isCustomFee ? "bg-indigo-600" : "bg-gray-300"}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${isCustomFee ? "translate-x-6" : "translate-x-0.5"}`} />
          </div>
          <span className="text-sm font-medium text-gray-700">
            Use Custom Fee instead of standard plan pricing
          </span>
        </label>

        {isCustomFee && (
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Custom Monthly Fee (₦)</label>
            <input
              type="number"
              value={customFee}
              onChange={e => setCustomFee(e.target.value)}
              placeholder="e.g. 25000"
              className="border rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              This amount will be charged monthly regardless of agent count.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveBilling}
            disabled={saving}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Billing Settings"}
          </button>
          <p className="text-xs text-gray-400">
            Effective fee this cycle: <strong>{formatNaira(calculatedFee)}/mo</strong>
          </p>
        </div>

        {msg && (
          <p className={`mt-3 text-sm font-medium ${msg.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {msg.text}
          </p>
        )}
      </div>

      {/* ── Invoice / Billing History ── */}
      <div className="bg-white border rounded-xl p-5">
        <h3 className="font-semibold text-[15px] mb-4 text-gray-800">Billing History</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No billing records yet. First invoice generates after the trial period ends.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-400 text-xs font-medium">
                  <th className="pb-3 pr-4">Invoice #</th>
                  <th className="pb-3 pr-4">Period</th>
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Payment Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h: any) => (
                  <tr key={h.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-3 pr-4 font-mono text-xs text-gray-500">INV-{String(h.id).padStart(4, "0")}</td>
                    <td className="py-3 pr-4 text-xs">
                      {formatDate(h.periodStart)} → {formatDate(h.periodEnd)}
                    </td>
                    <td className="py-3 pr-4 font-semibold">{formatNaira(h.amount)}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        h.status === "Paid" ? "bg-green-50 text-green-700" :
                        h.status === "Pending" ? "bg-orange-50 text-orange-700" :
                        h.status === "Overdue" ? "bg-red-50 text-red-700" :
                        "bg-gray-100 text-gray-500"
                      }`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="py-3 text-xs text-gray-500">{formatDate(h.paymentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubscriptionsBillings;
