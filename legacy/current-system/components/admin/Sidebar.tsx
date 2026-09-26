
import React, { useState } from 'react'
import { Sidemenuitems } from "../../src/app/admin/utilis/sidebarmenuitems"
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';


interface DashboardHeaderProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const Sidebar = ({ isOpen, setIsOpen }: DashboardHeaderProps) => {

  const pathName = usePathname();

  return (
    <>
      {/* Overlay backdrop */}
      {isOpen && window.innerWidth < 1024 && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/20 backdrop-blur-md z-40 lg:hidden"
        />
      )}
      <div className={`fixed top-0 left-0 h-screen pt-[88px]  transition-transform w-[264px] z-40 bg-[#150E46] text-[#E9E6FF] dark:bg-gray-900  dark:border dark:border-gray-500 shadow-md ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:block`}>
        <div className="flex flex-col gap-[8px]  antialiased font-inter font-normal h-full overflow-y-auto pb-8 px-3">
          {Sidemenuitems.map((items, index) => {
            return (
              <div key={index}>
                <Link href={items.path} onClick={() => setIsOpen(false)} className={`flex items-center gap-[12px] h-full py-2 px-4 ${items.path === pathName ? "bg-[#7A69FC] text-white rounded-md h-[40px]" : ""}`}>
                  <Image src={items.icon} alt={items.title + " icon"} className='my-[auto]' width={18} height={18} />
                  <span className='leading-[24px]  text-[14px] my-[auto] antialiased'>{items.title}</span>
                </Link>
              </div>
            );
          })
          }

        </div>
      </div>
    </>
  )
}

export default Sidebar;