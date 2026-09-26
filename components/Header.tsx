"use client";
import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { FiChevronDown, FiChevronUp, FiX } from "react-icons/fi";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { HiBars3BottomRight } from "react-icons/hi2";

const Header = () => {
  const [openDropdown, setOpenDropdown] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileDropdown, setMobileDropdown] = useState("");

  const menuRef = useRef(null);

  // Close desktop dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !(menuRef.current as any).contains(e.target)) {
        setOpenDropdown("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleDesktop = (menu: string) => {
    setOpenDropdown(openDropdown === menu ? "" : menu);
  };

  const toggleMobileDropdown = (menu: string) => {
    setMobileDropdown(mobileDropdown === menu ? "" : menu);
  };


  const pathname = usePathname()

  const isActive = (path: string) => pathname === path;



  return (
    <div className="w-full">

      {/* TOP BAR */}
      <div className="bg-black shadow-md py-3 px-20 max-sm:px-5 max-sm:py-2 flex justify-between items-center flex-wrap max-sm:flex-col max-sm:gap-3">
        <div className="flex gap-6 items-center  max-sm:justify-center flex-wrap max-sm:gap-3">
          <div className="flex items-center gap-2">
            <Image src="/icons/si_mail-line.svg" alt="mail" width={15} height={15} />
            <p className="font-semibold text-white text-sm">support@alphakolect.com</p>
          </div>
          <div className="flex items-center gap-2">
            <Image src="/icons/Vector.svg" alt="phone" width={15} height={15} />
            <p className="font-semibold text-white text-sm">+2347032343467</p>
          </div>
        </div>
        <Link href="/login" className="text-sm text-white font-semibold">Admin Login</Link>
      </div>

      {/* MAIN HEADER */}
      <div ref={menuRef} className="py-3 px-20 bg-white shadow-lg flex items-center justify-between relative max-sm:px-5">

        <div className="flex items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <Image src="/images/logo.png" alt="Logo" width={40} height={40} />
            <h1 className="font-inter text-lg">Alphakolect</h1>
          </div>

          {/* Desktop Nav */}
          <div className="hidden lg:flex gap-6 items-center relative">

            <Link href="/" className={isActive("/") ? "text-blue-600 font-semibold cursor-pointer hover:text-blue-600 transition" : "text-gray-600 font-semibold cursor-pointer hover:text-blue-600 transition"}>
              Home
            </Link>

            {/* Solutions */}
            <div className="relative">
              <button
                onClick={() => toggleDesktop("solutions")}
                className="flex items-center gap-1 font-semibold text-gray-600 hover:text-blue-600"
              >
                Solutions
                {openDropdown === "solutions" ? <FiChevronUp /> : <FiChevronDown />}
              </button>

              {openDropdown === "solutions" && (
                <div onClick={() => toggleDesktop("")} className="absolute top-8 left-[-90px] bg-white shadow-lg rounded-md w-[700px] z-50 px-8 py-8 animate-slideDown">

                  <div className="flex gap-5">
                    {/* Left Column */}
                    <div className="flex flex-col flex-1 gap-4">

                      <Link href="/financial"><div className="p-3 hover:bg-gray-100 cursor-pointer rounded-md">
                        <h1 className="font-inter font-semibold text-md">
                          For Financial Institutions</h1>
                        <p className="text-sm">
                          Digitize and control collections, loans, and investments across your network.
                        </p>
                      </div>
                      </Link>

                      <Link href="/agents"> <div className="p-3 hover:bg-gray-100 cursor-pointer rounded-md">
                        <h1 className="font-inter font-semibold text-md">For Agents</h1>
                        <p className="text-sm">
                          Empower your agents with the Alphakolect mobile app.
                        </p>
                      </div>
                      </Link>

                      <Link href="/customers"> <div className="p-3 hover:bg-gray-100 cursor-pointer rounded-md">
                        <h1 className="font-inter font-semibold text-md">For End Customers</h1>
                        <p className="text-sm">
                          Give your customers visibility and control over their finances.
                        </p>
                      </div>
                      </Link>
                    </div>

                    {/* Right Column */}
                    <div className="flex flex-col gap-3 flex-1">

                      <div className="bg-[#E9E6FF] p-4 rounded-md">
                        <p className="text-sm text-[#4E37FB]">
                          “Alphakolect has modernized the way collections are handled.”
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <Image src="/images/avi.png" alt="quote" width={50} height={50} />
                          <div>
                            <p className="text-md">James Boluwatife</p>
                            <p className="text-sm text-[#60646C]">CEO, Didan Microfinance</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-[#E9E6FF] p-4 rounded-md">
                        <p className="text-sm text-[#4E37FB]">
                          “I love using the mobile app and dashboard features.”
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <Image src="/images/avi.png" alt="quote" width={50} height={50} />
                          <div>
                            <p className="text-md">James Boluwatife</p>
                            <p className="text-sm text-[#60646C]">CEO, Didan Microfinance</p>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Resources */}
            <div className="relative">
              <button
                onClick={() => toggleDesktop("resources")}
                className="flex items-center gap-1 font-semibold text-gray-600 hover:text-blue-600"
              >
                Resources
                {openDropdown === "resources" ? <FiChevronUp /> : <FiChevronDown />}
              </button>

              {openDropdown === "resources" && (
                <div onClick={() => toggleDesktop("")} className="absolute top-8 left-0 bg-white shadow-lg rounded-md w-[360px] z-50 py-2 animate-slideDown">

                  <Link href="/help"> <div className="px-4 py-3 hover:bg-gray-100 cursor-pointer rounded-md">
                    <h1 className="font-inter font-semibold">Help Center</h1>
                    <p className="text-sm">Find answers and support.</p>
                  </div>
                  </Link>

                  <Link href="/contact"><div className="px-4 py-3 hover:bg-gray-100 cursor-pointer rounded-md">
                    <h1 className="py-1 cursor-pointer hover:bg-gray-100 font-inter font-semibold">Contact Us</h1>
                    <p className="text-sm">Reach our support team.</p>
                  </div>
                  </Link>

                  <div className="px-4 py-3 hover:bg-gray-100 cursor-pointer rounded-md">
                    <h1 className="font-inter font-semibold">Download Guide</h1>
                    <p className="text-sm">Get setup documentation.</p>
                  </div>

                </div>
              )}
            </div>

            <Link href="/pricing" className={isActive("/pricing") ? "text-blue-600 font-semibold cursor-pointer hover:text-blue-600 transition" : "text-gray-600 font-semibold cursor-pointer hover:text-blue-600 transition"}>
              Pricing
            </Link>
          </div>
        </div>

        {/* Right Buttons - Desktop */}
        <div className="hidden lg:flex gap-2 items-center">
          <Link href="/login" ><p className="cursor-pointer font-semibold text-gray-600">Log in</p></Link>
          <Link href="/signup" >
            <button className="bg-[#4E37FB] text-white px-4 py-2 rounded-sm font-semibold">
              Sign up
            </button>
          </Link>
        </div>

        {/* Mobile Hamburger */}
        <button
          onClick={() => setMobileMenu(true)}
          className="lg:hidden text-3xl text-gray-700"
        >
          <HiBars3BottomRight />
        </button>
      </div>

      {/* Mobile Menu (Slide from Right) */}

      {mobileMenu && window.innerWidth < 1024 && (
        <div
          onClick={() => setMobileMenu(false)}
          className="fixed inset-0 bg-black/20 backdrop-blur-md z-40 lg:hidden"
        />
      )}
      <div
        className={`lg:hidden fixed top-0 right-0 h-full w-72 bg-white shadow-xl z-50 transform transition-transform duration-300 ${mobileMenu ? "translate-x-0" : "translate-x-full"
          }`}
      >
        {/* Close */}
        <div className="flex justify-end p-4">
          <button
            onClick={() => setMobileMenu(false)}
            className="text-3xl text-gray-700"
          >
            <FiX />
          </button>
        </div>

        {/* Mobile Menu Items */}
        <div className="flex flex-col gap-4 px-6">
          <Link
            href="/"
            onClick={() => setMobileMenu(false)}
            className={`font-semibold border-b pb-2 
    ${isActive("/") ? "text-blue-600" : "text-gray-700"}
  `}
          >
            Home
          </Link>


          {/* Solutions Mobile Accordion */}
          <div>
            <button
              onClick={() => toggleMobileDropdown("solutions")}
              className="w-full flex justify-between items-center py-2 font-semibold text-gray-700"
            >
              Solutions
              {mobileDropdown === "solutions" ? <FiChevronUp /> : <FiChevronDown />}
            </button>

            {mobileDropdown === "solutions" && (
              <div onClick={() => setMobileMenu(false)} className="pl-3 flex flex-col gap-2 text-sm text-gray-600 animate-slideDown">
                <Link href='/financial'><p className="py-1 cursor-pointer hover:bg-gray-100">Financial Institutions</p></Link>
                <Link href='/agents'><p className="py-1 cursor-pointer hover:bg-gray-100">Agents</p></Link>
                <Link href='/customers'><p className="py-1 cursor-pointer hover:bg-gray-100">End Customers</p></Link>
              </div>
            )}
          </div>

          {/* Resources Mobile Accordion */}
          <div>
            <button
              onClick={() => toggleMobileDropdown("resources")}
              className="w-full flex justify-between items-center py-2 font-semibold text-gray-700"
            >
              Resources
              {mobileDropdown === "resources" ? <FiChevronUp /> : <FiChevronDown />}
            </button>

            {mobileDropdown === "resources" && (
              <div onClick={() => setMobileMenu(false)} className="pl-3 flex flex-col gap-2 text-sm text-gray-600 animate-slideDown">
                <Link href="/help" className="py-1 cursor-pointer hover:bg-gray-100">Help Center</Link>
                <Link href="/contact" className="py-1 cursor-pointer hover:bg-gray-100">Contact Us</Link>
                <p className="py-1 cursor-pointer hover:bg-gray-100">Download Guide</p>
              </div>
            )}
          </div>

          <Link onClick={() => setMobileMenu(false)} href="/pricing" className={`font-semibold border-b pb-2 
    ${isActive("/pricing") ? "text-blue-600" : "text-gray-700"}
  `}>Pricing</Link>

          <Link onClick={() => setMobileMenu(false)} href="/login" className="text-gray-700 font-semibold border-b pb-2">Log in</Link>

          
            <button onClick={() => setMobileMenu(false)} className="bg-[#4E37FB] cursor-pointer text-white py-2 rounded-sm font-semibold">
              <Link href="/signup" >Sign up</Link>
           
            </button>
  
        </div>
      </div>
    </div>
  );
};

export default Header;
