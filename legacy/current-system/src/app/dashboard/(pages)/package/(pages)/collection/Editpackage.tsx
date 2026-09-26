"use client"
import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import { FaAngleDown } from 'react-icons/fa'


interface pack {
  edit: boolean,
  onClose: () => void;
}

import { updatePackage } from '../../../../../../../services/api'

const Editpackage = ({ edit, onClose }: pack) => {
  const [form, setForm] = useState({
    id: 0,
    name: '',
    type: 'Flexible',
    seedType: 'Percentage',
    seedAmount: '',
    period: '',
    collectionDays: 'Daily',
    amount: '',
    duration: '',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Expecting window.__pkgToEdit set by parent before opening
    const pkg: any = (window as any).__pkgToEdit
    if (pkg) {
      setForm({
        id: pkg.id,
        name: pkg.name || '',
        type: pkg.type || 'Flexible',
        seedType: pkg.seedType || 'Percentage',
        seedAmount: String(pkg.seedAmount ?? ''),
        period: String(pkg.period ?? ''),
        collectionDays: pkg.collectionDays || 'Daily',
        amount: String(pkg.amount ?? ''),
        duration: String(pkg.duration ?? ''),
      })
    }
  }, [edit])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const id = (e.target as any).id
    const { value } = e.target as any
    setForm(prev => ({ ...prev, [id]: value }))
  }

  const handleSubmit = async () => {
    try {
      setLoading(true)
      await updatePackage({
        id: form.id,
        name: form.name,
        type: form.type,
        amount: Number(form.amount || 0),
        seedAmount: Number(form.seedAmount || 0),
        seedType: form.seedType,
        period: Number(form.period || 0),
        collectionDays: form.collectionDays,
        duration: Number(form.duration || 0),
        benefits: [],
        packageCategory: 'Collection',
      })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Overlay backdrop */}
      {edit && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/20  z-50 "
        />
      )}
      <div className={`fixed top-0 right-0 h-screen w-full max-w-full sm:w-[532px] bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out z-50
          flex flex-col  ${edit ? 'translate-x-0' : 'translate-x-full'}`}>


        <div className="flex p-4 items-center justify-between">
          <h1 className='text-[20px] font-inter font-semibold leading-[30px] max-md:text-[14px]'>Edit package</h1>
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
              <select id="seedType" value={form.seedType} onChange={handleChange} className='w-full appearance-none h-[45px] border border-[#D0D5DD] outline-none p-[10px] rounded-[4px]'>
                <option value="Percentage">Percentage</option>
                <option value="First Saving">First Saving</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                <FaAngleDown className="w-[16px] h-[16px] text-[#8E8E93]" />
              </div>
            </div>
          </div>


          <div className="mb-4">
            <p className='mb-1 font-inter font-medium text-[14px] leading-[20px]'>Seed amount/percentage</p>
            <input id="seedAmount" value={form.seedAmount} onChange={handleChange} type="text" placeholder='10%' className='w-full h-[45px] border border-[#D0D5DD] p-[10px] rounded-[4px] outline-none' />
          </div>


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
        </div>

        <div className='border-t-[1px] w-full mb-1  mt-5'></div>

        <div className='mt-[15px] flex justify-center mb-8'>
          <button onClick={handleSubmit} disabled={loading} className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-[167px] rounded-[4px] items-center gap-[9px] justify-center disabled:opacity-60'>
            {loading && (<svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"></svg>)}
            <p className='text-[14px] font-inter text-white font-medium'>{loading ? 'Updating...' : 'Edit package'}</p>
          </button>
        </div>
      </div>
    </>
  )
}

export default Editpackage