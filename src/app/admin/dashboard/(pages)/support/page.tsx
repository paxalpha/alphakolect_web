'use client'
import React, { useState } from 'react'
import SupportTickets from '../../../../../../components/tables/supports/SupportTickets';
import Announcements from '../../../../../../components/tables/supports/Announcements';
import Faqs from '../../../../../../components/tables/supports/Faqs';

const Page = () => {

    const [activeTab, setActiveTab] = useState("Support_tickets");

    return (
        <div>
            <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
                <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
                    <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Support</h1>
                    <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px] '>Manage and handle all issues by Merchants .</p>
                </div>
            </div>

            <div className='bg-white shadow-lg mt-6 mb-2'>
                <div className="flex items-center flex-nowrap pt-5 border-b border-gray-300 overflow-x-auto whitespace-nowrap hide-scrollbar">
                    {[
                        { id: "Support_tickets", label: "Support Tickets" },
                        { id: "Announcements", label: "Announcements" },
                        { id: "FAQs", label: "FAQs" }
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-shrink-0 relative font-inter px-6 pb-2 text-sm sm:text-base transition-all ${activeTab === tab.id
                                ? "font-semibold text-[#1E1E1E] text-base"
                                : "font-normal text-[#9E9E9E] text-base"
                                }`}
                        >
                            {tab.label}
                            <span
                                className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-10/12 transition-all ${activeTab === tab.id ? "bg-[#4E37FB] h-[3px]" : ""
                                    }`}
                            />
                        </button>
                    ))}
                </div>

                <div className="overflow-x-auto ">
                    {activeTab === "Support_tickets" && <SupportTickets />}
                    {activeTab === "Announcements" && <Announcements />}
                    {activeTab === "FAQs" && <Faqs />}
                </div>
            </div>
        </div>
    )
}

export default Page