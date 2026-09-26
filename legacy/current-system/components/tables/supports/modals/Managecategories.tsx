import React, { useState } from 'react'
import { FaPlus } from 'react-icons/fa';


interface ManagecategoryProps {
    category: boolean;
    onClose: () => void;
}

function Managecategory({ category, onClose }: ManagecategoryProps) {

    if (!category) return null;


    return (
        <div>
            <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
                <div className='lg:w-[400px] w-[90%] absolute bg-white rounded-[12px] flex flex-col gap-[20px] p-[24px]'>
                    <h1 className='font-inter font-semibold '>Manage categories</h1>

                    <div className=''>
                        <button className='w-full border border-[#D0D5DD] rounded-[4px] h-[40px] flex items-center justify-between px-3'>
                            <p className='font-inter text-[14px] text-[#101828]'>Onboarding</p>
                            <img src='/icons/delred.svg' alt='arrow-down' />
                        </button>
                    </div>

                    <div className=''>
                        <button className='w-full border border-[#D0D5DD] rounded-[4px] h-[40px] flex items-center justify-between px-3'>
                            <p className='font-inter text-[14px] text-[#101828]'>Payments</p>
                            <img src='/icons/delred.svg' alt='arrow-down' />
                        </button>
                    </div>


                    <div className=''>
                        <button className='w-full border border-[#D0D5DD] rounded-[4px] h-[40px] flex items-center justify-between px-3'>
                            <p className='font-inter text-[14px] text-[#101828]'>Transactions</p>
                            <img src='/icons/delred.svg' alt='arrow-down' />
                        </button>
                    </div>


                    <div className=''>
                        <button className='w-full flex items-center gap-2'>
                            <FaPlus className='text-[#4E37FB] font-normal w-[12px]' />
                            <p className='font-inter text-[14px] text-[#4E37FB] font-semibold'>Add category</p>
                           
                        </button>
                    </div>




                    <div className="flex justify-center mt-2 gap-[15px]">
                        <button onClick={onClose} className='bg-white flex h-[40px] cursor-pointer w-[167px] border border-[#D0D5DD] rounded-[4px] items-center gap-[9px] justify-center'>
                            <p className='text-[14px] font-inter font-semibold'>Close</p>
                        </button>

                        <button className='bg-[#4E37FB] flex h-[40px]  cursor-pointer w-[167px] rounded-[4px] items-center gap-[9px] justify-center'>
                            <p className='text-[14px] font-inter text-white font-semibold'>Save</p>
                        </button>

                    </div>
                </div>
            </div>
        </div>
    )
}

export default Managecategory;