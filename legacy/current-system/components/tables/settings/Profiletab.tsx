import React from 'react'
import Image from 'next/image'
import z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form'

const schema = z.object({
    full_name: z.string().min(1, "full name is required"),
    email: z.string().email("email is required"),
    role: z.string().min(1, "role is required"),
})


type formdata = z.infer<typeof schema>

function Profiletab() {

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
            <form onSubmit={handleSubmit(onSubmit)}>
                <div className=" border m-8 max-md:m-4">
                    <div className='lg:w-[500px] w-70% p-6 max-md:p-4 flex flex-col gap-[15px] '>
                    <p>Profile details</p>
                    <Image src="/images/pp.png" alt='pp' width={100} height={100} />
                    <div>
                        <p className="mb-1 text-sm font-medium font-inter">Full Name</p>
                        <input
                            type="text"
                            placeholder="John Doe"
                            {...register("full_name")}
                            className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                        />
                        <p className="text-sm text-red-500">{errors?.full_name?.message }</p>
                    </div>

                    <div>
                        <p className="mb-1 text-sm font-medium font-inter">Email</p>
                        <input
                            type="text"
                            placeholder="John doe@gmail.com"
                            {...register("email")}
                            className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                        />
                        <p className="text-sm text-red-500">{errors?.email?.message }</p>
                    </div>


                    <div>
                        <p className="mb-1 text-sm font-medium font-inter">Role</p>
                        <input
                            type="text"
                            placeholder="Supa Admin"
                            {...register("role")}
                            className="w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none"
                        />
                        <p className="text-sm text-red-500">{errors.role?.message }</p>
                    </div>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={!isValid || isSubmitting}
                    className={`bg-[#4E37FB] text-white font-medium h-[40px] m-auto mb-8 w-[167px] rounded-[4px] flex items-center justify-center ${!isValid || isSubmitting
                        ? "opacity-70 cursor-not-allowed"
                        : "cursor-pointer"
                        }`}
                >
                    Save Changes
                </button>
            </form>


        </div>
    )
}

export default Profiletab