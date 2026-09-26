import Image from 'next/image';
import React from 'react'


interface props{
    label:string,
    icon:string,
    count:number
}
const Dashboardcards = ({label, count, icon}: props) => {
  return (
    <div>
        <div className='flex items-center gap-2 bg-white w-full h-[98px] px-5 py-5 dark:bg-gray-900 dark:border dark:border-gray-700'>
            <Image src={icon} alt={icon} width={50} height={50} />
            <div className='flex flex-col gap-1'>
                <h1 className='font-inter font-medium leading-[20px] text-[14px] text-[#737373] dark:text-white'>{label}</h1>
                <p className='font-inter font-semibold leading-[28px] text-[16px]'>{count}</p>
            </div>
        </div>
    </div>
  )
}

export default Dashboardcards;