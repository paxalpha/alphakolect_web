"use client"
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form'
import { MerchantData } from '../../../../interface/type'
import adminAPI from '@/app/admin/utilis/adminApi';


const schema = z.object({
    title: z.string().min(1, "title is required"),
    category: z.string().min(1, "category is required"),
    content: z.string().min(1, "content is required"),
})

type formdata = z.infer<typeof schema>

interface AddPackageProps {
    packag: boolean;
    onClose: () => void;
    mode: 'add' | 'edit';
    merchant?: any | null
}

const AddEditFaqs = ({ packag, onClose, mode, merchant }: AddPackageProps) => {

    const
        { register,
            handleSubmit,
            formState: { errors, isValid, isSubmitting },
            reset
        } = useForm<formdata>({
            resolver: zodResolver(schema),
            mode: "onChange",
        });

    const queryClient = useQueryClient();

    useEffect(() => {
        if (mode === "edit" && merchant) {
            reset({
                title: merchant.question,
                category: merchant.category,
                content: merchant.answer,

            });
        } else {
            reset({
                title: "",
                category: "",
                content: "",

            });
        }
    }, [mode, merchant, reset]);


    const addFaq = useMutation({
        mutationFn: async (data: formdata) => {
             return await adminAPI.createFaq({
                question: data.title,
                answer: data.content,
                category: data.category,
                isActive: true
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["allFaqs"] });
            onClose();
            reset();
            alert("FAQ created successfully!");
        },
        onError: (error: any) => {
             alert(`Failed to create FAQ: ${error.message}`);
        }

    })


    const editFaq = useMutation({
        // Editing capability needs to be added to backend first if not present, checking controller... 
        // Only getAll, create, delete for FAQs were added. Edit was not requested in previous steps.
        // I will stub this to alert user or implement if I missed it, but based on recent history only delete/create/get exists. 
        // Assuming user just wants CREATE for now as per instructions "implement create...". 
        // If edit is needed, I'd need to add Update endpoint. For now I will leave edit logic but maybe disable it or warn.
        // Actually, let's just assume we might add it later or reuse create for now (which is wrong).
        // I'll make it fail gracefully or just log for now as "Not implemented".
        mutationFn: async (data: formdata) => {
            // throw new Error("Edit functionality not yet implemented in backend");
             console.log("Edit requested:", data);
             return {};
        },

        onSuccess: () => {
             alert("Edit functionality is pending backend implementation.");
            // queryClient.invalidateQueries({ queryKey: ["merchants"] });
        },
        onError(error: any) {
             alert(error.message);
        }
    })

    const onSubmit = (data: formdata) => {
        console.log(data)
        if (mode === "add") {
            addFaq.mutate(data)
        } else {
            editFaq.mutate(data)
        }

        //onClose()
        // reset()
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
                        {mode === "add" ? "Add FAQ" : "Edit FAQ"}
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
                            <p className="mb-1 text-sm font-medium font-inter">Title</p>
                            <input
                                type="text"
                                placeholder="John Doe"
                                {...register("title")}
                                className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                            />
                            <p className="text-sm text-red-500">{errors.title?.message}</p>
                        </div>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Category</p>
                            <select
                                {...register("category")}
                                className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]"
                            >
                                <option value="">Select category</option>
                                <option value="Admin">Admin</option>
                                <option value="Officer">Officer</option>
                            </select>
                            <p className="text-sm text-red-500">{errors.category?.message}</p>
                        </div>


                        <div>
                            <p className="mb-1 text-sm font-medium">Content</p>
                            <textarea
                                {...register("content")}
                                className="w-full h-[100px] border p-2 rounded outline-none resize-none"
                                placeholder="Enter Content"
                            />
                            <p className="text-sm text-red-500">{errors.content?.message}</p>
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
                        {addFaq.isPending || editFaq.isPending
                            ? "Saving..."
                            : mode === "add"
                                ? "Add FAQ"
                                : "Save Changes"}
                    </button>
                </div>


            </div>
        </>
    );

}

export default AddEditFaqs;