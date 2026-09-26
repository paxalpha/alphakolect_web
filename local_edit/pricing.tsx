"use client";
import React, { useState } from 'react'
import { motion } from "framer-motion"
import { Plus, Minus } from "lucide-react";
import Footer from 'components/Footer';
import Link from 'next/link';


const fadeUp = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0 }
};


const fadeLeft = {
    hidden: { opacity: 0, x: -40 },
    visible: { opacity: 1, x: 0 }
};

const fadeScale = {
    hidden: { opacity: 0, scale: 0.85 },
    visible: { opacity: 1, scale: 1 }
};
const Page = () => {


    const faqs = [
        {
            question: "What is Alphakolect?",
            answer: "Alphakolect is a Daily Contribution, Loans (Microcredit) and Target Savings management solution. It comprises of Web part (for Administration, support and reports), Agent Mobile App (for Agents to interface with customers) and Customer App (for Customers to engage and follow up transactions with their respective merchant)",
        },
        {
            question: "Who can use Alphakolect?",
            answer: "Any microfinance institution that engages in the traditional Daily Contribution system with customers.",
        },
        {
            question: "How does Alphakolect help financial institutions?",
            answer: "Transparently monitoring of transactions by customers, and Microfinance Institution owners.",
        },
        {
            question: "What can agents do with the Alphakolect app?",
            answer: "Agents can process and track transactions via the Agent mobile app.",
        },
        {
            question: "What benefits do end-user customers get?",
            answer: "Customers can track transactions, make requests to their respective merchants and get support via the Customer Mobile App.",
        },
        {
            question: "Is Alphakolect secure?",
            answer: "Alphakolect is hosted or secured dedicated servers with encrypted connections.",
        },
        {
            question: "How does pricing work?",
            answer: "There are 5 plans available; Starter, Growth, Mid-Level, Large and Enterprise plans. All newly registered merchants are however automatically placed in Starter level while upgrading to other levels flexibly as the business grows. Details in the Pricing section.",
        },
        {
            question: "How long does it take to get started?",
            answer: "Register and start using Alphakolect instantly. User guides are available for further understanding while online and physical (onsite) training can be arranged for the staff.",
        },
        {
            question: "Where can I get support?",
            answer: "For support and enquiries, Send email to support@alphakolect.com or call/WhatsApp 09050226306.",
        },
    ];


    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const toggle = (i: number) => {
        setOpenIndex(openIndex === i ? null : i);
    };
    return (
        <>

            <div className='bg-custom-143'>
                <motion.div
                    className="w-full max-w-3xl px-4 sm:px-6 flex flex-col gap-6 items-center m-auto pt-12 text-white"
                    variants={fadeUp}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.7 }}
                >

                    <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold text-center">Get that Needed Control</h1>

                    <p className="text-sm leading-relaxed font-inter font-medium text-center max-w-prose">choose a plan that fits your institution’s scale. Pay only for what you need. No hidden charges.</p>
                </motion.div>


                <div className=' mt-14 pb-20 flex items-center justify-center px-12 max-lg:flex-col gap-4 max-lg:gap-12 '>


                    <motion.div
                        className="text-white border w-[90%] lg:max-w-[250px] border-[#E9E6FF} bg-[#150E46] rounded-md flex flex-col gap-3 px-6 py-6"
                        variants={fadeLeft}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        transition={{ duration: 0.9 }}
                    >

                        <h1 className='text-xl font-inter font-semibold'>Pro</h1>
                        <p>Small financial institutions starting digital collections</p>
                        <h1 className='font-inter text-3xl font-semibold'>$50 <sub>/mo</sub></h1>
                        <p>Billed annually</p>
                        <button
                            className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[90%] m-auto lg:max-w-[250px] px-3 transition-colors duration-200 hover:brightness-90"
                            aria-label="Get started"
                        >
                            <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                        </button>

                        <div className="">
                            <ul className='flex flex-col gap-2 list-disc list-inside'>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                            </ul>
                        </div>
                    </motion.div>



                    <motion.div
                        className="text-white border w-[90%] lg:max-w-[250px] border-[#E9E6FF} bg-[#150E46] rounded-md flex flex-col gap-3 px-6 py-6"
                        variants={fadeUp}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        transition={{ duration: 0.9 }}
                    >
                        <h1 className='text-xl font-inter font-semibold'>Pro</h1>
                        <p>Small financial institutions starting digital collections</p>
                        <h1 className='font-inter text-3xl font-semibold'>$50 <sub>/mo</sub></h1>
                        <p>Billed annually</p>
                        <button
                            className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[90%] m-auto lg:max-w-[250px] px-3 transition-colors duration-200 hover:brightness-90"
                            aria-label="Get started"
                        >
                             <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                        </button>

                        <div className="">
                            <ul className='flex flex-col gap-2 list-disc list-inside'>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                            </ul>
                        </div>
                    </motion.div>

                    
                    <motion.div
                        className="text-white border w-[90%] lg:max-w-[250px] border-[#E9E6FF} bg-[#4E37FB] rounded-md flex flex-col gap-3 px-6 py-6 relative"
                        variants={fadeScale}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        transition={{ duration: 0.9 }}
                    >
                        <h1 className="w-[70%] lg:max-w-[200px] absolute top-[-29px] left-1/2 -translate-x-1/2 bg-[#7A69FC] text-white px-3 py-1 text-center font-inter text-sm font-medium">MOST POPULAR</h1>

                        <h1 className='text-xl font-inter font-semibold'>Pro</h1>
                        <p>Small financial institutions starting digital collections</p>
                        <h1 className='font-inter text-3xl font-semibold'>$50 <sub>/mo</sub></h1>
                        <p>Billed annually</p>
                        <button
                            className="bg-white inline-flex h-[44px] items-center gap-3 justify-center text-[#4E37FB] font-medium rounded-md w-[90%] m-auto lg:max-w-[250px] px-3 transition-colors duration-200 hover:brightness-90"
                            aria-label="Get started"
                        >
                           <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                        </button>

                        <div className="">
                            <ul className='flex flex-col gap-2 list-disc list-inside'>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                            </ul>
                        </div>
                    </motion.div>
                    



                    <motion.div
                        className="text-white border w-[90%] lg:max-w-[250px] border-[#E9E6FF} bg-[#150E46] rounded-md flex flex-col gap-3 px-6 py-6"
                        variants={fadeUp}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        transition={{ duration: 0.9 }}
                    >

                        <h1 className='text-xl font-inter font-semibold'>Pro</h1>
                        <p>Small financial institutions starting digital collections</p>
                        <h1 className='font-inter text-3xl font-semibold'>$50 <sub>/mo</sub></h1>
                        <p>Billed annually</p>
                        <button
                            className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[90%] m-auto lg:max-w-[250px] px-3 transition-colors duration-200 hover:brightness-90"
                            aria-label="Get started"
                        >
                            <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                        </button>

                        <div className="">
                            <ul className='flex flex-col gap-2 list-disc list-inside'>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                                <li>List item</li>
                            </ul>
                        </div>
                    </motion.div>
                </div>
            </div >

            <div className="mt-12 mb-12">
                <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold text-center">Frequently Asked Questions</h1>
                <div className="w-[90%] lg:w-[60%]  m-auto mt-12 ">
                    {faqs.map((faq, i) => (
                        <div
                            key={i}
                            className="border-t rounded-md p-4 cursor-pointer"
                            onClick={() => toggle(i)}
                        >

                            <motion.div
                                className="flex justify-between items-center"
                                variants={fadeLeft}
                                initial="hidden"
                                whileInView="visible"
                                viewport={{ once: true }}
                                transition={{ duration: 0.8, delay: 0.2 }}
                            >
                                <h3 className="font-semibold text-lg">{faq.question}</h3>

                                <div className="">
                                    {openIndex === i ? <Minus /> : <Plus />}
                                </div>

                            </motion.div>

                            {openIndex === i && (
                                <p className="mt-3 text-gray-600">{faq.answer}</p>
                            )}
                        </div>
                    ))}
                </div>

                <p className="text-center m-auto w-[90%] md:w-[60%] mt-4">Still have more questions? Please write to <span className="text-[#4E37FB]">support@alphakolect.com</span> or call/WhatsApp 09050226306 and we will respond as quickly as we can.</p>
            </div>

            <Footer />
        </>
    )
}

export default Page;