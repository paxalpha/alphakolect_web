"use client"
import React, {useState} from 'react';
import DashboardHeader from '../../../../components/admin/Header';
import DashBoardFooter from '../../../../components/admin/Footer';
import Sidebar from '../../../../components/admin/Sidebar';


export default function DashboardLayout({ children }: { children: React.ReactNode }) {

  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <div className="flex flex-col  h-screen w-full">
      {/* header  */}
      <DashboardHeader setIsOpen={setIsOpen} isOpen={isOpen} />
    
      <div className="flex flex-1 overflow-x-hidden">
       {/* Sidebar  */}
      
      <Sidebar setIsOpen={setIsOpen} isOpen={isOpen}/>

       <div className='flex flex-col flex-1 min-w-0 bg-[#EBEBEB] dark:bg-gray-900'>
        <main  className=" flex-1 overflow-y-auto md:px-5 px-4 pt-[90px] max-md:text-sm antialiased ">
          {children}
        </main>

        <DashBoardFooter />
        </div>

      </div>
    </div>
  );
}
