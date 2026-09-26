"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Swal from 'sweetalert2';
import { createInvestment, fetchCustomers } from '@/services/api';

interface CustomerOption {
	id: number;
	fullName?: string;
	name?: string;
}

export default function CreateInvestmentPage() {
	const router = useRouter();
	const [customers, setCustomers] = useState<CustomerOption[]>([]);
	const [form, setForm] = useState({
		customerId: '',
		amount: '',
		plan: '',
		duration: '',
	});
	const [submitting, setSubmitting] = useState(false);
	const [loadingCustomers, setLoadingCustomers] = useState(true);

	useEffect(() => {
		const load = async () => {
			try {
				setLoadingCustomers(true);
				const res: any = await fetchCustomers();
				setCustomers((res?.customers || res || []) as CustomerOption[]);
			} catch (e) {
				setCustomers([]);
			} finally {
				setLoadingCustomers(false);
			}
		};
		load();
	}, []);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		const { name, value } = e.target;
		setForm((prev) => ({ ...prev, [name]: value }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		try {
			const selected = customers.find((c) => c.id === Number(form.customerId));
			await createInvestment({
				customerName: selected?.fullName || selected?.name || '',
				amount: Number(form.amount),
				plan: form.plan,
				duration: Number(form.duration),
			});
			Swal.fire({ icon: 'success', title: 'Success', text: 'Investment created successfully.' });
        router.push('/dashboard/investment/investments');
		} catch (error: any) {
			Swal.fire({ icon: 'error', title: 'Error', text: error?.message || 'Failed to create investment.' });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="p-6">
			<div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6">
				<h1 className="text-2xl font-semibold mb-4">Create Investment</h1>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
						<select
							name="customerId"
							value={form.customerId}
							onChange={handleChange}
							className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
							required
							disabled={loadingCustomers}
						>
							<option value="">{loadingCustomers ? 'Loading customers...' : 'Select customer'}</option>
							{customers.map((c) => (
								<option key={c.id} value={c.id}>
									{c.fullName || c.name || `Customer ${c.id}`}
								</option>
							))}
						</select>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
						<input
							type="number"
							name="amount"
							value={form.amount}
							onChange={handleChange}
							min="0"
							step="0.01"
							className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
							required
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
						<input
							type="text"
							name="plan"
							value={form.plan}
							onChange={handleChange}
							placeholder="e.g. Fixed Deposit"
							className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
							required
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Duration (days)</label>
						<input
							type="number"
							name="duration"
							value={form.duration}
							onChange={handleChange}
							min="1"
							className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
							required
						/>
					</div>

					<div className="flex items-center gap-3">
						<button
							type="submit"
							className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
							disabled={submitting}
						>
							{submitting ? 'Submitting...' : 'Create Investment'}
						</button>
						<button
							type="button"
							className="border border-gray-300 px-4 py-2 rounded hover:bg-gray-50"
							onClick={() => router.back()}
						>
							Cancel
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
