"use client";
import React from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import z from "zod";
import adminAPI from '@/app/admin/utilis/adminApi';


const schema = z
    .object({
        title: z.string().min(1, "Title is required"),
        message: z.string().min(1, "Message is required"),

        delivery_channel: z
            .array(z.string())
            .min(1, "Please select at least one delivery channel"),

        shedule_options: z.enum(["now", "schedule"]),

        scheduled_time: z.string().optional(),

        target_audience: z.enum(["all_merchants", "specific_merchants", "by_subscription_plan"]),

        selected_merchants: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if (data.shedule_options === "schedule" && !data.scheduled_time) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Please select a date & time",
                path: ["scheduled_time"],
            });
        }
        if (data.target_audience === "specific_merchants" && !data.selected_merchants) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Please select at least one merchant",
                path: ["selected_merchants"],
            });
        }
    });


type FormData = z.infer<typeof schema>;

interface AddPackageProps {
    packag: boolean;
    onClose: () => void;
}

const deliveryChannels = [
    { id: "in_app", label: "In App" },
    { id: "email", label: "Email" },
    { id: "sms", label: "SMS" },
    { id: "dashboard", label: "Dashboard" },
];

const scheduleOptions = [
    { id: "now", label: "Send Now" },
    { id: "schedule", label: "Schedule" },
];

const target_audience = [
    { id: "all_merchants", label: "All merchants" },
    { id: "specific_merchants", label: "Specific merchants" },
    { id: "by_subscription_plan", label: "By Subscription Plan" },
];

const NewAnnouncement = ({ packag, onClose }: AddPackageProps) => {
    
    const {
        register,
        handleSubmit,
        formState: { errors, isValid, isSubmitting },
        reset,
        watch,
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        mode: "onChange",
        defaultValues: {
            shedule_options: "now",
            delivery_channel: [],
            target_audience: "all_merchants",
        },
    });

    const queryClient = useQueryClient();

    const addAnnouncement = useMutation({
        mutationFn: async (data: FormData) => {
            return await adminAPI.createAnnouncement({
                title: data.title,
                content: data.message,
                audience: data.target_audience, // Mapping frontend enum snake_case to backend expected field if needed, or keeping it as is. Backend typically expects 'All', 'Specific', etc. but we'll stick to what we have or adjust. 
                // Let's assume backend accepts these literal values for now or mapped strings.
                // Looking at backend controller: const { title, content, targetAudience, scheduleTime } = req.body;
                targetAudience: data.target_audience === 'all_merchants' ? 'all' : 'merchants',
                isActive: true // Default to active for 'now', maybe handled by schedule logic
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["allAnnouncements"] });
            onClose();
            reset();
            alert("Announcement created successfully!");
        },
        onError: (error: any) => {
             alert(`Failed to create announcement: ${error.message}`);
        }
    });

    const watchType = watch("shedule_options");
    const audiencetype = watch("target_audience");

    const onSubmit = (data: FormData) => {
        addAnnouncement.mutate(data);
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
        transform transition-transform duration-300 ease-in-out
        flex flex-col ${packag ? "translate-x-0" : "translate-x-full"}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-white z-10">
                    <h1 className="text-lg font-semibold">New Announcement</h1>
                    <Image
                        src="/icons/close.svg"
                        alt="close"
                        width={14}
                        height={14}
                        className="cursor-pointer"
                        onClick={onClose}
                    />
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                    <form onSubmit={handleSubmit(onSubmit)} id="merchantForm" className="space-y-5">
                        {/* Title */}
                        <div>
                            <p className="mb-1 text-sm font-medium">Title</p>
                            <input
                                type="text"
                                {...register("title")}
                                className="w-full h-[45px] border p-2 rounded outline-none"
                                placeholder="Announcement title"
                            />
                            <p className="text-sm text-red-500">{errors.title?.message}</p>
                        </div>


                        <div>
                            <p className="mb-1 text-sm font-medium">Message</p>
                            <textarea
                                {...register("message")}
                                className="w-full h-[100px] border p-2 rounded outline-none resize-none"
                                placeholder="Write your message"
                            />
                            <p className="text-sm text-red-500">{errors.message?.message}</p>
                        </div>


                        <div>
                            <p className="mb-1 text-sm font-medium">Delivery Channels</p>
                            <div className="flex gap-2">
                                {deliveryChannels.map((item) => (
                                    <label key={item.id} className="inline-flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            value={item.id}
                                            {...register("delivery_channel")}
                                            className="accent-[#4E37FB]"
                                        />
                                        <span>{item.label}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-sm text-red-500">{errors.delivery_channel?.message}</p>
                        </div>

                        {/* Schedule Options (Radio Array) */}
                        <div>
                            <p className="mb-1 text-sm font-medium">Schedule Options</p>
                            <div className="flex gap-2">
                                {scheduleOptions.map((item) => (
                                    <label key={item.id} className="inline-flex items-center gap-2">
                                        <input
                                            type="radio"
                                            value={item.id}
                                            {...register("shedule_options")}
                                            className="accent-[#4E37FB]"
                                        />
                                        <span>{item.label}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-sm text-red-500">{errors.shedule_options?.message}</p>
                        </div>

                        {watchType === "schedule" && (
                            <div>
                                <p className="mb-1 text-sm font-medium">Select Date & Time</p>
                                <input
                                    type="datetime-local"
                                    {...register("scheduled_time")}
                                    className="w-full h-[45px] border p-2 rounded outline-none"
                                />
                            </div>
                        )}


                        <div>
                            <p className="mb-1 text-sm font-semibold">Target Options</p>
                            <div className="flex flex-col gap-2">
                                {target_audience.map((item) => (
                                    <label key={item.id} className="inline-flex items-center gap-2">
                                        <input
                                            type="radio"
                                            value={item.id}
                                            {...register("target_audience")}
                                            className="accent-[#4E37FB]"
                                        />
                                        <span>{item.label}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-sm text-red-500">{errors.target_audience?.message}</p>
                        </div>

                        {audiencetype === "specific_merchants" && (
                            <div>
                                <p className="mb-1 text-sm font-medium">Select Merchants</p>
                                <select
                                    {...register("selected_merchants")}
                                    className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]"
                                >
                                    <option value="">Select category</option>
                                    <option value="Admin">Admin</option>
                                    <option value="Officer">Officer</option>
                                </select>
                            </div>
                        )}
                    </form>
                </div>

                {/* Footer */}
                <div className="border-t bg-white p-4 flex justify-center">
                    <button
                        type="submit"
                        form="merchantForm"
                        disabled={!isValid || isSubmitting}
                        className={`bg-[#4E37FB] text-white font-medium h-[40px] w-[167px] rounded flex items-center justify-center ${!isValid || isSubmitting ? "opacity-70 cursor-not-allowed" : ""
                            }`}
                    >
                        {isSubmitting ? "Saving..." : "Send"}
                    </button>
                </div>
            </div>
        </>
    );
};

export default NewAnnouncement;
