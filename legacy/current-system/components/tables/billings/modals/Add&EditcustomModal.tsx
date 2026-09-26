"use client"
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { MerchantData } from '../../../../interface/type'


const schema = z.object({
    plan_type: z.string().min(1, "plan_type is required"),
    plan_name: z.string().min(1, "plan_name is required"),
    billing_cycle: z.string().min(1, "billing_cycle is required"),
    pricing: z.string().min(1, "pricing is required"),
    start_date: z.string().min(1, "start_date is required"),
    renewal_date: z.string().min(1, "renewal_date is required"),
    merchants: z.string().min(1, "merchants is required"),
    number_branches: z.string().min(1, "number_branches is required"),
    number_customer: z.string().min(1, "number_customer is required"),
    number_agents: z.string().min(1, "number_agents is required"),
})

type formdata = z.infer<typeof schema>

interface AddPackageProps {
    packag: boolean;
    onClose: () => void;
    mode: 'add' | 'edit';
    merchant?: MerchantData | null
}

const AddCustom = ({ packag, onClose, mode, merchant }: AddPackageProps) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors, isValid },
        reset
    } = useForm<formdata>({
        resolver: zodResolver(schema),
        mode: "onChange",
        defaultValues: { plan_type: "custom" }
    });

    useEffect(() => {
        if (packag && mode === "edit" && merchant) {
            reset({
                plan_name: String(merchant.package ?? ""),
                plan_type: String(merchant.customer ?? "custom"),
                merchants: String(merchant.no_of_agents ?? ""),
                billing_cycle: String(merchant.id ?? ""),
                start_date: String(merchant.created ?? ""),
                pricing: String(merchant.amount ?? ""),
                number_agents: String(merchant.method ?? "")
            });
        } else if (packag && mode === "add") {
            reset({
                plan_name: "",
                plan_type: "custom",
                merchants: "",
                billing_cycle: "",
                start_date: "",
                pricing: "",
                renewal_date: "",
                number_branches: "",
                number_customer: "",
                number_agents: ""
            });
        }
    }, [packag, mode, merchant, reset]);

    const onSubmit = async (data: formdata) => {
        setIsSubmitting(true);
        
        try {
           
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (mode === "add") {
                console.log("addpackagedata", data);
            } else {
                console.log("editpackagedata", data);
            }

            onClose();
            reset();
        } catch (error) {
            console.error("Error:", error);
        } finally {
            setIsSubmitting(false);
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
                                <option value="custom">Custom</option>
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


                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Start date</p>
                            <input
                                type="date"
                                placeholder="John Doe"
                                {...register("start_date")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.start_date?.message}</p>
                        </div>


                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Renewal date</p>
                            <input
                                type="date"
                                placeholder="John Doe"
                                {...register("renewal_date")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.renewal_date?.message}</p>
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Merchants</p>
                            <div className="relative w-full">
                                <select
                                    {...register("merchants")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none"
                                >
                                    <option value="">Select role</option>
                                    <option value="Admin">Admin</option>
                                    <option value="Officer">Officer</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            <p className="text-sm text-red-500">{errors.merchants?.message}</p>
                        </div>

                        <h1 className='font-inter font-semibold'>Feature list</h1>

                        <div>
                            <div className='flex gap-2 items-center mb-1'>
                                <input type="checkbox" />
                                <p className="mb-1 text-sm font-medium font-inter">Number of Branches</p>
                            </div>
                            <p className="mb-1 text-sm font-medium font-inter">Upto</p>
                            <input
                                type="number"
                                placeholder="20"
                                {...register("number_branches")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.number_branches?.message}</p>
                        </div>


                        <div>
                            <div className='flex gap-2 items-center mb-1'>
                                <input type="checkbox" />
                                <p className="mb-1 text-sm font-medium font-inter">Number of Customers</p>
                            </div>
                            <p className="mb-1 text-sm font-medium font-inter">Upto</p>
                            <input
                                type="number"
                                placeholder="20"
                                {...register("number_customer")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.number_customer?.message}</p>
                        </div>

                        <div>
                            <div className='flex gap-2 items-center mb-1'>
                                <input type="checkbox" />
                                <p className="mb-1 text-sm font-medium font-inter">Number of Agents</p>
                            </div>
                            <p className="mb-1 text-sm font-medium font-inter">Upto</p>
                            <input
                                type="number"
                                placeholder="20"
                                {...register("number_agents")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.number_agents?.message}</p>
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
                        {isSubmitting
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

export default AddCustom;