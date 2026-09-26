import React from 'react'

const Securitytab = () => {
    return (
        <div>
            <div className='border m-8 p-6 max-md:p-4 max-md:m-4 flex flex-col gap-[30px]'>

                <div className=' flex flex-col gap-[5px]'>
                    <div className='flex flex-wrap justify-between item-center gap-2'>
                        <p className='font-inter font-semibold'>Change password</p>
                        <p className='text-[#4E37FB] font-inter font-semibold'>Change password</p>
                    </div>

                    <p className='text-sm text-[#98A2B3]'>Click to change email. You will need to authenticate with your authenticator to proceed.</p>
                </div>



                <div className=' flex flex-col gap-[5px]'>
                    <div className='flex justify-between item-center flex-wrap gap-3'>
                        <p className='font-inter font-semibold'>Two-factor authentication</p>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                // {...register(`donationTypes.${index}.active`)}
                                className="sr-only peer"
                            // defaultChecked={field.active}
                            />
                            <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:bg-[#4E37FB] transition-all duration-200" />
                            <div className="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 peer-checked:translate-x-5" />
                        </label>
                    </div>


                    <p className='text-sm text-[#98A2B3]'>This is automatically turned on to give you an extra layer of security.</p>
                </div>
            </div>



        </div>
    )
}

export default Securitytab