"use client"
import { useState, useEffect } from "react";
import { HiBars3BottomRight, HiSun, } from "react-icons/hi2";
import { FaTimes } from "react-icons/fa";
import Image from "next/image";
import Link from "next/link";

interface DashboardHeaderProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const DashboardHeader = ({ isOpen, setIsOpen }: DashboardHeaderProps) => {

  // Function to toggle the menu state
  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };


  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);


  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const [tab, setTab] = useState(false)



  return (
    <>
      <div className="fixed top-0 h-[56px] left-0 right-0 dark:border dark:border-gray-500 z-50 bg-white dark:bg-gray-900 dark:text-white border-b-[1px] flex items-center justify-between p-4">

        {/* Logo and Menu Toggle Button */}

        <div className="flex items-center gap-[10px] ">
          <div className="lg:hidden cursor-pointer">
            {isOpen ? (
              <FaTimes className='text-[15px]' onClick={toggleMenu} />
            ) : (
              <HiBars3BottomRight className='text-[20px]' onClick={toggleMenu} />
            )}
          </div>

          <div className="lg:ml-3 flex items-center gap-[10px]">
            <Image src="/images/logo.png" alt="logo" width={25} height={25} className="cursor-pointer" />
            <h1 className="font-inter ">Alpakolect</h1>
          </div>

        </div>


        {/* Desktop search bar */}
        <div className="hidden md:flex dark:border dark:border-gray-500 items-center h-[40px] lg:ml-40 lg:w-[311px] gap-[4px] border border-[#E5E7EB] rounded-lg px-3">
          <Image src="/icons/search.png" alt="dashboard" width={20} height={20} className="cursor-pointer" />
          <input
            type="text"
            placeholder="Search"
            className="outline-none border-none px-3 py-2 w-full text-sm dark:bg-gray-900 "
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
            <Image src="/icons/search.png" alt="search" width={20} height={20} className="cursor-pointer" />
          </button>

          <div className="bg-[#FAF9FF] dark:bg-gray-900  p-2 cursor-pointer" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? (
              <HiSun className='text-[20px]' />
            ) : (

              <Image
                src="/icons/theme.svg"
                alt="theme"
                width={18}
                height={18}
                className="cursor-pointer "
              />
            )}
          </div>

          <div className="relative flex bg-[#FAF9FF] dark:bg-gray-900  p-2 items-center justify-center cursor-pointer">
            <Image
              src="/icons/bell.svg"
              width={18}
              height={18}
              alt="notification"
              className="dark:bg-white "
            />
            <span className="absolute top-0 right-0 bg-red-500 text-white text-xs max-sm:text-[11px] rounded-full w-4 h-4 flex items-center justify-center">
              <p>{1}</p>
            </span>
          </div>

          <div className="relative">
          <div  onClick={() => setTab(!tab)}  className={`p-2 rounded-full bg-[#FAF9FF] text-[#4E37FB] cursor-pointer flex items-center justify-center text-purple text-sm font-bold `}>
            OR
          </div>
          {tab && <div onClick={() => setTab(false)} className="absolute right-0 bg-white shadow-lg flex flex-col gap-[10px]  cursor-pointer rounded-lg w-[280px]">
            <div className="flex items-center bg-white gap-[10px] px-6 py-2 ">
              <Image src='/icons/Avatar.svg' alt="avater" width={50} height={50}/>
              <div className="flex flex-col">
                <p>Olivia Rhye</p>
                <p>olivia@untitledui.com</p>
              </div>
            </div>

            <hr/>

             <Link href={"/admin/dashboard/settings"}><p className="px-6 hover:bg-gray-100">View Profile</p></Link>
            <Link href={"/admin/dashboard/settings"}><p className="px-6 hover:bg-gray-100 ">Settings</p></Link>

            <hr />

            <p className="px-6 mb-2 hover:bg-gray-100">Logout</p>
          </div>}
          </div>

        </div>
      </div>
      {/* Mobile search overlay */}
      {showMobileSearch && (
        <div className="fixed inset-0 z-[100] bg-black bg-opacity-40 flex items-start justify-center md:hidden">
          <div className="bg-white w-full dark:bg-gray-900 p-4 flex items-center gap-2 shadow-lg animate-slide-in-top">
            <input
              type="text"
              placeholder="Search..."
              className="outline-none px-3 py-2 w-full text-sm border border-[#E5E7EB] rounded-lg"
              autoFocus
            />
            <button
              className="p-2 font-bold"
              onClick={() => setShowMobileSearch(false)}
              aria-label="Close search"
            >
              <FaTimes className='text-[15px]' onClick={() => setIsOpen(false)} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default DashboardHeader;









