"use client"
import React, { useEffect } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

const schema = z.object({
    role_name: z.string().min(1, "Role name is required"),
    dashboard: z.string().min(1, "Dashboard permission is required"),
    merchants: z.string().min(1, "Merchants permission is required"),
    transactions: z.string().min(1, "Transactions permission is required"),
    billings: z.string().min(1, "Plans & billings permission is required"),
    audits: z.string().min(1, "Audit logs permission is required"),
    support: z.string().min(1, "Support & messages permission is required"),
})

type RoleFormData = z.infer<typeof schema>

interface RoleMember {
  id: string | number;
  roleName?: string;
  name?: string;
  cantView?: string;
  canViewOnly?: string;
  canEdit?: string;
  permissions?: string[];
  lastUpdated?: string;
  updatedAt?: string;
  created?: string;
  createdAt?: string;
}

interface AddRolesProps {
    packag: boolean;
    onClose: () => void;
    mode: 'add' | 'edit';
    merchant: RoleMember | null;
    onAddRole?: (data: RoleFormData) => void;
    onUpdateRole?: (data: RoleFormData, id: string) => void;
}

const Addroles = ({
    packag,
    onClose,
    mode,
    merchant,
    onAddRole,
    onUpdateRole,
}: AddRolesProps) => {
    const {
        register,
        handleSubmit,
        formState: { errors, isValid },
        reset,
        setValue,
    } = useForm<RoleFormData>({
        resolver: zodResolver(schema),
        mode: "onChange",
    });


    useEffect(() => {
        if (mode === "edit" && merchant) {
            setValue("role_name", merchant.roleName || merchant.name || "");
            
            const perms = merchant.permissions || [];
            
            const getLevel = (viewPerm: string, editPerms: string[] = []) => {
                if (editPerms.some(p => perms.includes(p))) return "full";
                if (perms.includes(viewPerm)) return "view";
                return "none";
            };

            setValue("dashboard", getLevel('view_dashboard')); 
            setValue("merchants", getLevel('view_merchants', ['create_merchant', 'edit_merchant', 'delete_merchant']));
            setValue("transactions", getLevel('view_transactions', ['approve_transaction', 'refund_transaction']));
            setValue("billings", getLevel('view_plans', ['create_plan', 'edit_plan']));
            setValue("audits", getLevel('view_logs', ['view_activities'])); 
            setValue("support", "none"); 
        } else {
            reset({
                role_name: "",
                dashboard: "",
                merchants: "",
                transactions: "",
                billings: "",
                audits: "",
                support: ""
            });
        }
    }, [mode, merchant, reset, setValue]);

    const onSubmit = (data: RoleFormData) => {
        if (mode === "add") {
            onAddRole?.(data);
        } else if (merchant?.id) {
            onUpdateRole?.(data, String(merchant.id));
        }

        onClose();
        reset();
    };

    return (
        <>
            {/* Backdrop */}
            {packag && (
                <div
                    onClick={onClose}
                    className="fixed inset-0 bg-black/20 z-40"
                />
            )}

            
            <div
                className={`fixed inset-y-0 right-0 h-screen w-[90%] sm:w-[500px] bg-white shadow-xl z-50
                    transform transition-transform duration-300 ease-in-out flex flex-col
                    ${packag ? 'translate-x-0' : 'translate-x-full'}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-white z-10">
                    <h1 className="text-lg font-semibold font-inter max-md:text-base">
                        {mode === "add" ? "Create Role" : "Edit Role"}
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

                {/* Scrollable Form */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                    <form onSubmit={handleSubmit(onSubmit)} id="roleForm" className="space-y-5">
                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Role name</p>
                            <input
                                type="text"
                                placeholder="e.g. Super Admin"
                                {...register("role_name")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            {errors.role_name && <p className="text-sm text-red-500 mt-1">{errors.role_name.message}</p>}
                        </div>

                        <h1 className='font-inter font-semibold text-[16px] mt-6'>Access permissions</h1>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Dashboard</p>
                            <div className="relative w-full">
                                <select
                                    {...register("dashboard")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                                >
                                    <option value="">Select permission</option>
                                    <option value="full">Full Access</option>
                                    <option value="view">View Only</option>
                                    <option value="none">No Access</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            {errors.dashboard && <p className="text-sm text-red-500 mt-1">{errors.dashboard.message}</p>}
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Merchants</p>
                            <div className="relative w-full">
                                <select
                                    {...register("merchants")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                                >
                                    <option value="">Select permission</option>
                                    <option value="full">Full Access</option>
                                    <option value="view">View Only</option>
                                    <option value="none">No Access</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            {errors.merchants && <p className="text-sm text-red-500 mt-1">{errors.merchants.message}</p>}
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Transactions</p>
                            <div className="relative w-full">
                                <select
                                    {...register("transactions")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                                >
                                    <option value="">Select permission</option>
                                    <option value="full">Full Access</option>
                                    <option value="view">View Only</option>
                                    <option value="none">No Access</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            {errors.transactions && <p className="text-sm text-red-500 mt-1">{errors.transactions.message}</p>}
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Plans & billings</p>
                            <div className="relative w-full">
                                <select
                                    {...register("billings")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                                >
                                    <option value="">Select permission</option>
                                    <option value="full">Full Access</option>
                                    <option value="view">View Only</option>
                                    <option value="none">No Access</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            {errors.billings && <p className="text-sm text-red-500 mt-1">{errors.billings.message}</p>}
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Audit logs</p>
                            <div className="relative w-full">
                                <select
                                    {...register("audits")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                                >
                                    <option value="">Select permission</option>
                                    <option value="full">Full Access</option>
                                    <option value="view">View Only</option>
                                    <option value="none">No Access</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            {errors.audits && <p className="text-sm text-red-500 mt-1">{errors.audits.message}</p>}
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Support & messages</p>
                            <div className="relative w-full">
                                <select
                                    {...register("support")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                                >
                                    <option value="">Select permission</option>
                                    <option value="full">Full Access</option>
                                    <option value="view">View Only</option>
                                    <option value="none">No Access</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                                </div>
                            </div>
                            {errors.support && <p className="text-sm text-red-500 mt-1">{errors.support.message}</p>}
                        </div>
                    </form>
                </div>

                {/* Footer */}
                <div className="border-t bg-white p-4 flex justify-center">
                    <button
                        type="submit"
                        form="roleForm"
                        disabled={!isValid}
                        className={`bg-[#4E37FB] text-white font-medium h-[40px] w-[167px] rounded-[4px] flex items-center justify-center transition
                            ${!isValid
                                ? "opacity-70 cursor-not-allowed"
                                : "hover:bg-[#3e2ce8] cursor-pointer"
                            }`}
                    >
                        {mode === "add" ? "Create role" : "Save Changes"}
                    </button>
                </div>
            </div>
        </>
    );
}

export default Addroles;