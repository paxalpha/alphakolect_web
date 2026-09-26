"use client"
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { MerchantData } from '../../../../interface/type'

const schema = z.object({
  Name: z.string().min(1, "Merchant name is required"),
  no_of_agents: z.string().min(1, "no of agents is required"),
  no_of_customers: z.string().min(1, "no of customers is required"),
  email: z.string().min(1, "Business email is required"),
  plan: z.string().min(1, "Business plan is required"),
})

type formdata = z.infer<typeof schema>

interface AddPackageProps {
  packag: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  merchant?: MerchantData | null;
  onSubmitMerchant: (data: MerchantData, mode: 'add' | 'edit') => void;
}

const Addpackage = ({ packag, onClose, mode, merchant, onSubmitMerchant }: AddPackageProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset
  } = useForm<formdata>({
    resolver: zodResolver(schema),
    mode: "onChange",
  });

  useEffect(() => {
    if (mode === "edit" && merchant) {
      reset({
        no_of_agents: merchant.no_of_agents,
        no_of_customers: merchant.no_of_customers,
        Name: merchant.customer,
        email: merchant.id,
        plan: merchant.package,
      });
    } else {
      reset({
        Name: "",
        no_of_agents: "",
        no_of_customers: "",
        email: "",
        plan: "",
      });
    }
  }, [mode, merchant, reset]);

  const onSubmit = async (data: formdata) => {
    setIsSubmitting(true);
    
    try {
      // Transform form data to MerchantData structure
      const merchantData: MerchantData = {
        id: mode === 'edit' && merchant ? merchant.id : `COL-${Math.floor(Math.random() * 900 + 100)}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 90 + 10)}`,
        package: data.plan,
        no_of_agents: data.no_of_agents,
        no_of_customers: data.no_of_customers,
        customer: data.Name,
        method: "wallet",
        status: mode === 'edit' && merchant ? merchant.status : 'active',
        created: mode === 'edit' && merchant ? merchant.created : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      };

      onSubmitMerchant(merchantData, mode);

      
      await new Promise(resolve => setTimeout(resolve, 500));

      reset();
      onClose();
    } catch (error) {
      console.error('Error submitting merchant:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <div className="flex items-center justify-between p-4 border-b bg-white z-10">
          <h1 className="text-lg font-semibold font-inter max-md:text-base">
            {mode === "add" ? "Create Merchant" : "Edit Merchant"}
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
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {mode === "add" && (
            <p className='font-inter text-sm text-[#717680] text-center'>Fill the form below with merchants details and they will get an email with the necessary details to setup</p>
          )}
          <form onSubmit={handleSubmit(onSubmit)} id="merchantForm" className="space-y-5">
            <div>
              <p className="mb-1 text-sm font-medium font-inter">Name</p>
              <input
                type="text"
                placeholder="Name"
                {...register("Name")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              <p className="text-sm text-red-500">{errors.Name?.message}</p>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">No of agents</p>
              <input
                type="number"
                placeholder="Enter No of agents"
                {...register("no_of_agents")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              <p className="text-sm text-red-500">{errors.no_of_agents?.message}</p>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">No of customers</p>
              <input
                type="number"
                placeholder="Enter No of customers"
                {...register("no_of_customers")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              <p className="text-sm text-red-500">{errors.no_of_customers?.message}</p>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">Email</p>
              <input
                type="text"
                placeholder="johndoe@gmail.com"
                {...register("email")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              <p className="text-sm text-red-500">{errors.email?.message}</p>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">Plan</p>
              <div className="relative w-full">
                <select
                  {...register("plan")}
                  className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none"
                >
                  <option value="Free">Free</option>
                  <option value="Basic">Basic</option>
                   <option value="Pro">Pro</option>
                    <option value="Custom">Custom</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                  <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                </div>
              </div>
              <p className="text-sm text-red-500">{errors.plan?.message}</p>
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
                ? "Create Merchant"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  );
};

export default Addpackage;

