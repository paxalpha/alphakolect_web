"use client"
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form'
import { MerchantData } from '../../../../interface/type'
import adminAPI from '../../../../src/app/admin/utilis/adminApi';


const schema = z.object({
    plan_type: z.string().min(1, "plan_type is required"),
    plan_name: z.string().min(1, "plan_name is required"),
    billing_cycle: z.string().min(1, "billing_cycle is required"),
    pricing: z.string().min(1, "pricing is required"),
    max_agents: z.string().optional(),
    max_customers: z.string().optional(),
    max_transactions: z.string().optional(),
})

type formdata = z.infer<typeof schema>

interface AddPackageProps {
    packag: boolean;
    onClose: () => void;
    mode: 'add' | 'edit';
    merchant?: any | null
}

const AddStandard = ({ packag, onClose, mode, merchant }: AddPackageProps) => {

    const
        { register,
            handleSubmit,
            formState: { errors, isValid, isSubmitting },
            reset
        } = useForm<formdata>({
            resolver: zodResolver(schema),
            mode: "onChange",
            defaultValues: { plan_type: "standard" }
        });

    const queryClient = useQueryClient();

    useEffect(() => {
        if (mode === "edit" && merchant) {
            reset({
                plan_name: merchant.name || "",
                plan_type: "standard",
                max_customers: merchant.maxCustomers?.toString() || merchant.max_customers?.toString() || "",
                billing_cycle: merchant.billingCycle || merchant.billing_cycle || "",
                max_agents: merchant.maxAgents?.toString() || merchant.max_agents?.toString() || "",
                max_transactions: merchant.maxTransactions?.toString() || merchant.max_transactions?.toString() || "",
                pricing: merchant.pricing?.toString() || "",
            });
        } else {
            reset({
                plan_name: "",
                plan_type: "standard",
                max_customers: "",
                billing_cycle: "",
                max_agents: "",
                max_transactions: "",
                pricing: "",
            });
        }
    }, [mode, merchant, reset]);


    const addPlanMutation = useMutation({
        mutationFn: async (data: formdata) => {
            const planData = {
                type: data.plan_type,
                name: data.plan_name,
                billing_cycle: data.billing_cycle,
                pricing: parseFloat(data.pricing),
                max_agents: data.max_agents ? parseInt(data.max_agents) : null,
                max_customers: data.max_customers ? parseInt(data.max_customers) : null,
                max_transactions: data.max_transactions ? parseInt(data.max_transactions) : null,
                status: 'active',
                currency: 'NGN'
            };
            return adminAPI.createPlan(planData);
        },

        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["allPlans"] });
            queryClient.invalidateQueries({ queryKey: ["standardPlans"] });
            alert("Plan created successfully!");
            onClose();
        },
        onError(error: any) {
            alert(`Failed to create plan: ${error.message}`);
        }

    })


    const editPlanMutation = useMutation({
        mutationFn: async (data: formdata) => {
            const planData = {
                type: data.plan_type,
                name: data.plan_name,
                billing_cycle: data.billing_cycle,
                pricing: parseFloat(data.pricing),
                max_agents: data.max_agents ? parseInt(data.max_agents) : null,
                max_customers: data.max_customers ? parseInt(data.max_customers) : null,
                max_transactions: data.max_transactions ? parseInt(data.max_transactions) : null,
            };
            return adminAPI.updatePlan(merchant.id, planData);
        },

        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["allPlans"] });
            queryClient.invalidateQueries({ queryKey: ["standardPlans"] });
            alert("Plan updated successfully!");
            onClose();
        },
        onError(error: any) {
            alert(`Failed to update plan: ${error.message}`);
        }
    })

    const onSubmit = (data: formdata) => {
        console.log(data)
        if (mode === "add") {
            addPlanMutation.mutate(data)
            console.log("addPlanData", data)
        } else {
            editPlanMutation.mutate(data)
            console.log("editPlanData", data)
        }
    }

    return (
        <>
            {/* Overlay backdrop */}
            {packag && (
                <div
                    onClick={onClose}
                    className="fixed inset-0 bg-black/20 z-40"
                />
            )}

            {/* Drawer container */}
            <div
                className={`fixed inset-y-0 right-0 h-screen w-[90%] sm:w-[500px] bg-white shadow-xl z-50
        transform transition-transform duration-300 ease-in-out
        flex flex-col ${packag ? 'translate-x-0' : 'translate-x-full'}`}
            >
                {/* Header (fixed) */}
                <div className="flex items-center justify-between p-4 border-b  bg-white z-10">
                    <h1 className="text-lg font-semibold font-inter max-md:text-base">
                        {mode === "add" ? "Create Plan" : "Edit Plan"}
                    </h1>
                    <Image
                        src="/icons/close.svg"
                        alt="close"
                        width={14}
                        height={14}
                        className="cursor-pointer"
                        onClick={onClose}
                    />
                </div>

                {/* Scrollable form content */}
                <div className="flex-1 overflow-y-auto px-4 py-4 ">
                    <form onSubmit={handleSubmit(onSubmit)} id="merchantForm" className="space-y-5">

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Plan type</p>
                            <select
                                {...register("plan_type")}
                                className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]"
                            >
                                <option value="standard">standard</option>
                            </select>
                            <p className="text-sm text-red-500">{errors.plan_type?.message}</p>
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Plan name</p>
                            <input
                                type="text"
                                placeholder="John Doe"
                                {...register("plan_name")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.plan_name?.message}</p>
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Billing cycle</p>
                            <select
                                {...register("billing_cycle")}
                                className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]"
                            >
                                <option value="">Select</option>
                                <option value="monthly">Monthly</option>
                                <option value="weekly">Weekly</option>
                            </select>
                            <p className="text-sm text-red-500">{errors.billing_cycle?.message}</p>
                        </div>


                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Pricing</p>
                            <input
                                type="text"
                                placeholder="N20,000"
                                {...register("pricing")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.pricing?.message}</p>
                        </div>

                        <h1 className='font-inter font-semibold'>Feature list</h1>

                        <div>
                            <div className='flex gap-2 items-center mb-1'>
                                <input type="checkbox" />
                                <p className="mb-1 text-sm font-medium font-inter">Max Agents</p>
                            </div>
                            <p className="mb-1 text-sm font-medium font-inter">Upto (leave empty for unlimited)</p>
                            <input
                                type="text"
                                placeholder="20"
                                {...register("max_agents")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.max_agents?.message}</p>
                        </div>

                        <div>
                            <div className='flex gap-2 items-center mb-1'>
                                <input type="checkbox" />
                                <p className="mb-1 text-sm font-medium font-inter">Max Customers</p>
                            </div>
                            <p className="mb-1 text-sm font-medium font-inter">Upto (leave empty for unlimited)</p>
                            <input
                                type="text"
                                placeholder="100"
                                {...register("max_customers")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.max_customers?.message}</p>
                        </div>

                        <div>
                            <div className='flex gap-2 items-center mb-1'>
                                <input type="checkbox" />
                                <p className="mb-1 text-sm font-medium font-inter">Max Transactions</p>
                            </div>
                            <p className="mb-1 text-sm font-medium font-inter">Upto (leave empty for unlimited)</p>
                            <input
                                type="text"
                                placeholder="500"
                                {...register("max_transactions")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.max_transactions?.message}</p>
                        </div>

                    </form>
                </div>

                {/* Footer (fixed) */}
                <div className="border-t bg-white p-4 flex justify-center">
                    <button
                        type="submit"
                        form="merchantForm"
                        disabled={!isValid || isSubmitting}
                        className={`bg-[#4E37FB] text-white font-medium h-[40px] w-[167px] rounded-[4px] flex items-center justify-center ${!isValid || isSubmitting
                            ? "opacity-70 cursor-not-allowed"
                            : "cursor-pointer"
                            }`}
                    >
                        {addPlanMutation.isPending || editPlanMutation.isPending
                            ? "Saving..."
                            : mode === "add"
                                ? "Create plan"
                                : "Save Changes"}
                    </button>
                </div>


            </div>
        </>
    );

}

export default AddStandard;