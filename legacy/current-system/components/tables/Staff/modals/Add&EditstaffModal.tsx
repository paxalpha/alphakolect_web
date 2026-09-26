"use client"
import React, { useEffect } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

const schema = z.object({
  full_name: z.string().min(1, "Full name is required"),
  Email: z.string().email("Valid email is required"),
  phone_number: z.string().min(10, "Phone number must be at least 10 digits"),
  role: z.string().min(1, "Role is required"),
})

type FormData = z.infer<typeof schema>

interface AddPackageProps {
  packag: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  merchant: any; 
  onAddStaff?: (data: FormData) => void;
  onUpdateStaff?: (data: FormData, id: string) => void;
  rolesData?: any[];
}

const Addpackage = ({
  packag,
  onClose,
  mode,
  merchant,
  onAddStaff,
  onUpdateStaff,
  rolesData = [],
}: AddPackageProps) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid, isSubmitting },
    reset,
    setValue,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: "onChange",
  });

  
  useEffect(() => {
    if (mode === "edit" && merchant) {
      setValue("full_name", merchant.fullName || merchant.name || "");
      setValue("Email", merchant.email || "");
      setValue("phone_number", merchant.phoneNumber || "");
      setValue("role", merchant.role || merchant.AdminRole?.name || "");
    } else {
      reset({
        full_name: "",
        Email: "",
        phone_number: "",
        role: ""
      });
    }
  }, [mode, merchant, reset, setValue]);

  const onSubmit = (data: FormData) => {
    if (mode === "add") {
      onAddStaff?.(data);
    } else if (merchant?.id) {
      onUpdateStaff?.(data, merchant.id);
    }

    onClose();
    reset();
  };

  return (
    <>
    
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
            {mode === "add" ? "Create Staff" : "Edit Staff"}
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

       
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <form onSubmit={handleSubmit(onSubmit)} id="staffForm" className="space-y-5">
            <div>
              <p className="mb-1 text-sm font-medium font-inter">Full Name</p>
              <input
                type="text"
                placeholder="John Doe"
                {...register("full_name")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              {errors.full_name && <p className="text-sm text-red-500 mt-1">{errors.full_name.message}</p>}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">Email</p>
              <input
                type="email"
                placeholder="johndoe@gmail.com"
                {...register("Email")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              {errors.Email && <p className="text-sm text-red-500 mt-1">{errors.Email.message}</p>}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">Phone number</p>
              <input
                type="text"
                placeholder="+2347000000000"
                {...register("phone_number")}
                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
              />
              {errors.phone_number && <p className="text-sm text-red-500 mt-1">{errors.phone_number.message}</p>}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium font-inter">Role</p>
              <div className="relative w-full">
                <select
                  {...register("role")}
                  className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none bg-white"
                >
                  <option value="">Select role</option>
                  {rolesData.map((role: any) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <FaAngleDown className="w-4 h-4 text-[#8E8E93]" />
                </div>
              </div>
              {errors.role && <p className="text-sm text-red-500 mt-1">{errors.role.message}</p>}
            </div>
          </form>
        </div>

   
        <div className="border-t bg-white p-4 flex justify-center">
          <button
            type="submit"
            form="staffForm"
            disabled={!isValid || isSubmitting}
            className={`bg-[#4E37FB] text-white font-medium h-[40px] w-[167px] rounded-[4px] flex items-center justify-center transition
              ${!isValid || isSubmitting
                ? "opacity-70 cursor-not-allowed"
                : "hover:bg-[#3e2ce8] cursor-pointer"
              }`}
          >
            {isSubmitting
              ? "Saving..."
              : mode === "add"
                ? "Create Staff"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  );
}

export default Addpackage;