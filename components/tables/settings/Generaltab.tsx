
"use client"
import React, { useState } from 'react'
import Image from 'next/image'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form'
import { FaPlus } from 'react-icons/fa'
import Addeditaccountmodal from './modals/Addd&editaccountmodal';


const schema = z.object({
    currency: z.string().min(1, "currency is required"),
    time_zone: z.string().min(1, "time zone is required"),
})


type formdata = z.infer<typeof schema>

const Generaltab = () => {

    const [packag, setPackag] = useState<boolean>(false)
    const [mode, setMode] = useState<"add" | "edit">("add");
    const [selectedMerchant, setSelectedMerchant] = useState(null);

    const
        { register,
            handleSubmit,
            formState: { errors, isValid, isSubmitting },
            reset
        } = useForm<formdata>({
            resolver: zodResolver(schema),
            mode: "onChange",
        });

    const onSubmit = (data: formdata) => {
        console.log(data)
    }
    return (
        <div>

            <div className='border m-6  max-md:m-4'>
                <h1 className='font-inter font-semibold m-6  max-md:m-3 text-[24px]'>General</h1>
                <div className=" border m-6  max-md:m-4">
                    <div className='lg:w-[500px] w-70% p-6 max-md:p-4 flex flex-col gap-[15px] '>
                        <p className='font-inter font-semibold'>Currency and time</p>

                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Base currency</p>
                            <select
                                {...register("currency")}
                                className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] "
                            >
                                <option value="">Select currency</option>
                                <option value="naira">NGN N</option>
                                <option value="dollar">$</option>
                            </select>
                            <p className="text-sm text-red-500">{errors?.currency?.message}</p>
                        </div>




                        <div>
                            <p className="mb-1 text-sm font-medium font-inter">Time Zone</p>
                            <select
                                {...register("time_zone")}
                                className="w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] "
                            >
                                <option value="">Select zone</option>
                                <option value="West African GMT +1">West African GMT +1</option>
                                <option value=""></option>
                            </select>
                            <p className="text-sm text-red-500">{errors.time_zone?.message}</p>
                        </div>



                    </div>
                </div>

                <div className=" border m-6 p-6 max-md:p-4 max-md:m-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">

                        <div className="">
                            <h1 className='font-inter font-semibold'>Payment details</h1>
                            <p className='text-[#98A2B3]'>Connected accounts to receive payment</p>
                        </div>

                        <div className=" flex items-center gap-[10px] cursor-pointer">
                            <FaPlus className='text-[#4E37FB] font-normal w-[12px]' />
                            <p onClick={() => {
                                setMode("add");
                                setSelectedMerchant(null);
                                setPackag(true);
                            }} className='text-[#4E37FB] font-inter font-semibold'>Setup Account</p>
                        </div>

                    </div>


                    <div className='flex -items-center gap-[30px] shadow-md mt-4 w-fit p-4 max-sm:flex-col '>
                        <Image src="/icons/pay.svg" alt='pay' width={130} height={130} />
                        <div className="">
                            <div className='flex items-center gap-[30px] flex-wrap  max-sm:gap-2'>
                                <h1>Oluwaseun Adejobi - UBA</h1>
                                <div className='flex items-center gap-[10px] cursor-pointer'>
                                    <Image src='/icons/payedit.svg' alt="payedit" width={20} height={20} onClick={() => {
                                        setMode("edit");
                                        setSelectedMerchant(null);
                                        setPackag(true);
                                    }} />
                                    <Image src='/icons/deletepay.svg' alt="paydelete" width={20} height={20} />
                                </div>

                            </div>

                            <p className='text-[#98A2B3]'>Bank Account</p>
                            <p className='text-sm'>Manual payment - Powered by <span className='text-[#4E37FB] font-inter font-semibold'>Paystack</span></p>
                        </div>

                    </div>

                </div>
            </div>


            <Addeditaccountmodal
                packag={packag}
                onClose={() => setPackag(false)}
                mode={mode}
                merchant={selectedMerchant}
            />

        </div>
    )
}

export default Generaltab