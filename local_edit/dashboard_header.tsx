"use client"
import { useState } from "react";
import { HiBars3BottomRight, HiSun } from "react-icons/hi2";
import Image from "next/image";

interface DashboardHeaderProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const DashboardHeader = ({ isOpen, setIsOpen }: DashboardHeaderProps) => {

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  // Function to toggle the menu state
  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };


  const [showMobileSearch, setShowMobileSearch] = useState(false);

  return (
    <>
      <div className="fixed top-0 h-[56px] left-0 right-0  z-50 bg-white shadow-md flex items-center justify-between p-4">

        {/* Logo and Menu Toggle Button */}

        <div className="flex items-center gap-[10px] ">
          <div className="lg:hidden cursor-pointer">
            {isOpen ? (
              <Image src="/icons/close.svg" alt="dashboard" width={14} height={14} className="cursor-pointer" onClick={toggleMenu} />
            ) : (
              <HiBars3BottomRight className='text-[20px] ' onClick={toggleMenu} />
            )}
          </div>

          <div className="lg:ml-3">
            <h1 className="">LOGO</h1>
          </div>

        </div>


        {/* Desktop search bar */}
        <div className="hidden md:flex items-center h-[40px] lg:ml-40 lg:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-lg px-3">
          <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
          <input
            type="text"
            placeholder="Search"
            className="outline-none px-3 py-2 w-full text-sm"
          />
        </div>

        {/* Theme and Notification Icons */}

        <div className="flex items-center gap-[10px] justify-center">
          {/* Mobile search icon */}
          <button
            className="md:hidden flex items-center justify-center p-2"
            onClick={() => setShowMobileSearch(true)}
            aria-label="Open search"
          >
            <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
          </button>

          <div className="bg-[#FAF9FF] p-2">
            {isDarkMode ? (
              <Image
                src="/icons/theme.svg"
                alt="theme"
                width={18}
                height={18}
                className="cursor-pointer "
                onClick={() => setIsDarkMode(!isDarkMode)}
              />
            ) : (
              <HiSun className='text-[20px]' onClick={() => setIsDarkMode(!isDarkMode)} />
            )}
          </div>

          <div className="relative flex bg-[#FAF9FF] p-2 items-center justify-center cursor-pointer">
            <Image
              src="/icons/bell.svg"
              width={18}
              height={18}
              alt="notification"
            />
            <span className="absolute top-0 right-0 bg-red-500 text-white text-xs max-sm:text-[11px] rounded-full w-4 h-4 flex items-center justify-center">
              <p>{1}</p>
            </span>
          </div>


          <div className={`p-2 rounded-full bg-[#FAF9FF] text-[#4E37FB] cursor-pointer flex items-center justify-center text-purple text-sm font-bold `}>
            OR
          </div>

        </div>
      </div>
      {/* Mobile search overlay */}
      {showMobileSearch && (
        <div className="fixed inset-0 z-[100] bg-black bg-opacity-40 flex items-start justify-center md:hidden">
          <div className="bg-white w-full p-4 flex items-center gap-2 shadow-lg animate-slide-in-top">
            <input
              type="text"
              placeholder="Search..."
              className="outline-none px-3 py-2 w-full text-sm border border-[#E5E7EB] rounded-lg"
              autoFocus
            />
            <button
              className="p-2 text-[#4E37FB] font-bold"
              onClick={() => setShowMobileSearch(false)}
              aria-label="Close search"
            >
              <Image src="/icons/close.svg" alt="close search" width={18} height={18} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default DashboardHeader;









