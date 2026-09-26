"use client"
import React, { useState } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'


interface pack {
  packag: boolean,
  onClose: () => void;
}

import { createPackage } from '../../../../../../../services/api'

const Addpackage = ({ packag, onClose }: pack) => {
  const [form, setForm] = useState({
    name: '',
    type: 'Fixed',
    seedType: 'First Saving',
    seedAmount: '',
    period: '',
    collectionDays: 'Daily',
    amount: '',
    duration: '',
    dailyAmount: '',
  })
  const [loading, setLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { value, tagName } = e.target as any
    const id = (e.target as any).id
    
    // If type changes, automatically set seedType and reset related fields
    if (id === 'type') {
      if (value === 'Fixed') {
        setForm(prev => ({ 
          ...prev, 
          [id]: value, 
          seedType: 'First Saving',
          seedAmount: '' // Clear seed percentage for Fixed type
        }))
      } else if (value === 'Flexible') {
        setForm(prev => ({ 
          ...prev, 
          [id]: value, 
          seedType: 'Percentage',
          dailyAmount: '' // Clear daily amount for Flexible type
        }))
      }
    } else {
      setForm(prev => ({ ...prev, [id]: value }))
    }
  }

  const handleSubmit = async () => {
    try {
      setLoading(true)
      await createPackage({
        name: form.name,
        type: form.type,
        amount: form.type === 'Fixed' ? Number(form.dailyAmount || 0) : Number(form.amount || 0),
        seedAmount: form.type === 'Flexible' ? Number(form.seedAmount || 0) : Number(form.dailyAmount || 0),
        seedType: form.seedType,
        period: Number(form.period || 0),
        collectionDays: form.collectionDays,
        duration: Number(form.duration || 0),
        benefits: [],
        packageCategory: 'Collection',
      })
      onClose()
    } catch (e) {
      // no-op; page shows error toast area
    } finally {
      setLoading(false)
    }
  }

  return (
<>
     {/* Overlay backdrop */}
      {packag &&  (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/30  z-50 transition-opacity duration-300 ease-in-out "
        />
      )}

      <div className={`fixed top-0 right-0 h-screen w-full max-w-full sm:w-[532px] bg-white shadow-xl
          transition-transform duration-300 ease-in-out z-50 flex flex-col ${packag ? 'translate-x-0' : '-translate-x-full'} sm:translate-x-0`}>

       
          <div className="flex p-4 items-center justify-between">
            <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Create package</h1>
            <Image src="/icons/close.svg" alt="dashboard" width={14} height={14} className="cursor-pointer" onClick={onClose} />
          </div>
          <div className='border-t-[1px] w-full mb-1'></div>
        

        <div className="p-4 w-full overflow-y-auto hide-scrollbar">
          <div className="mb-4">
            <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Name</p>
            <input id="name" value={form.name} onChange={handleChange} type="text" placeholder='Alpha1k' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none' />
          </div>

          <div className="mb-4">
            <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Type</p>
            <div className='relative w-full'>
              <select id="type" value={form.type} onChange={handleChange} className='w-full appearance-none h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]'>
                <option value="Flexible">Flexible</option>
                <option value="Fixed">Fixed</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                <FaAngleDown className="w-[16px] h-[16px] text-[#8E8E93]" />
              </div>
            </div>
          </div>


          <div className="mb-4">
            <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Seed type</p>
            <div className='relative w-full'>
              <select id="seedType" value={form.seedType} onChange={handleChange} className='w-full appearance-none h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]' disabled>
                <option value="Percentage">Percentage</option>
                <option value="First Saving">First Saving</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                <FaAngleDown className="w-[16px] h-[16px] text-[#8E8E93]" />
              </div>
            </div>
            <p className='text-xs text-gray-500 mt-1'>Automatically set based on type</p>
          </div>

          {/* Show Seed Percentage only for Flexible type */}
          {form.type === 'Flexible' && (
            <div className="mb-4">
              <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Seed Percentage</p>
              <input id="seedAmount" value={form.seedAmount} onChange={handleChange} type="text" placeholder='10%' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none' />
            </div>
          )}

          {/* Show Daily Amount only for Fixed type */}
          {form.type === 'Fixed' && (
            <div className="mb-4">
              <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Daily Amount</p>
              <input id="dailyAmount" value={form.dailyAmount} onChange={handleChange} type="text" placeholder='1000' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none' />
            </div>
          )}


          <div className="mb-4">
            <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Period (days)</p>
            <input id="period" value={form.period} onChange={handleChange} type="text" placeholder='4' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px]' />
          </div>


          <div className="mb-2">
            <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Collection days</p>
            <div className='relative w-full'>
              <select id="collectionDays" value={form.collectionDays} onChange={handleChange} className='w-full h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px] appearance-none '>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                <FaAngleDown className="w-[16px] h-[16px] text-[#8E8E93]" />
              </div>
            </div>
          </div>

          {/* <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Amount</p>
              <input id="amount" value={form.amount} onChange={handleChange} type="text" placeholder='1000' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px]' />
            </div>
            <div>
              <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Duration (days)</p>
              <input id="duration" value={form.duration} onChange={handleChange} type="text" placeholder='30' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px]' />
            </div>
          </div> */}
        </div>


        <div className='border-t-[1px] w-full mb-1  mt-5'></div>

        <div className='mt-[15px] flex justify-center mb-8'>
          <button onClick={handleSubmit} disabled={loading} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[167px] rounded-[4px] items-center gap-[9px] justify-center disabled:opacity-60'>
            {loading && (<svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"></svg>)}
            <p className='text-[14px] font-inter text-white font-medium'>{loading ? 'Creating...' : 'Create package'}</p>
          </button>
        </div>

      </div>
    </>
  )
}

export default Addpackage