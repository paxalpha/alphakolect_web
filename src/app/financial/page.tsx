"use client"
import React from 'react'
import Footer from 'components/Footer';
import Image from 'next/image';
import { motion } from "framer-motion"
import Link from 'next/link';


    const fadeUp = {
        hidden: { opacity: 0, y: 40 },
        visible: { opacity: 1, y: 0 }
    };

    const fadeDown = {
        hidden: { opacity: 0, y: -40 },
        visible: { opacity: 1, y: 0 }
    };

    const fadeLeft = {
        hidden: { opacity: 0, x: -40 },
        visible: { opacity: 1, x: 0 }
    };

    const fadeRight = {
        hidden: { opacity: 0, x: 40 },
        visible: { opacity: 1, x: 0 }
    };
const Page = () => {



    return (
        <div>

            <motion.div
                className='bg-custom-143 flex py-20 lg:pl-20 gap-10 items-center justify-end max-lg:flex-col'
                variants={fadeLeft}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl text-white leading-tight md:leading-[1.2] font-bold max-lg:text-center">A complete platform to manage <span className='text-[#CE9200]'>agents, customers, and transactions</span></h1>

                    <p className="max-lg:text-center text-base text-white sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Manage agents, track customer savings, disburse loans, and grow investments, all in one secure platform. Gain real-time insights and streamline your processes for enhanced efficiencyz</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                         <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <Image src="/images/financial.png" alt="financial" width={650} height={650} className='max-lg:w-[500px] ' />


            </motion.div>


            <motion.div
                className=' flex justify-center gap-4 mt-12 px-5 max-lg:flex-col max-lg:items-center'
                variants={fadeRight}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className='lg:w-[50%] flex gap-2 py-4 bg-[#F6F6F6] max-lg:flex-col max-lg:items-center max-lg:w-full  max-lg:gap-8'>
                    <div className="w-full flex flex-col gap-3 lg:max-w-[350px] justify-end px-4">
                        <Image src="/images/management ico.png" alt="icon" width={30} height={30} />
                        <h1 className="font-inter font-semibold text-lg">Centralized Management</h1>
                        <p>Monitor agents, customers, and transactions all in one dashboard.</p>
                    </div>

                    <Image src="/images/management pic.png" alt="icon" width={300} height={300} className='lg:ml-auto flex items-end ' />

                </div>


                <div className=' max-lg:w-full flex flex-col bg-[#F6F6F6]  lg:max-w-[300px] gap-2 pb-2'>

                    <Image src="/images/oversite graph.png" alt="icon" width={70} height={70} className='ml-auto flex items-end' />

                    <div className='flex flex-col gap-2  px-5 '>
                        <Image src="/images/oversite ico.png" alt="icon" width={30} height={30} />
                        <h1 className='font-inter font-semibold'>Collections Oversight</h1>
                        <p className='text-base '>Track daily collections, verify remittances, and manage wallets digitally.</p>
                    </div>

                </div>

            </motion.div>



            <motion.div
                className='flex justify-center gap-4 mt-12 px-5 max-lg:flex-col max-lg:items-center'
                variants={fadeLeft}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                <div className=' max-lg:w-full flex flex-col bg-[#F6F6F6]  lg:max-w-[300px] gap-2 pb-2'>

                    <Image src="/images/security pic.png" alt="icon" width={70} height={70} className='ml-auto flex items-end' />

                    <div className='flex flex-col gap-2  px-5 '>
                        <Image src="/images/security ico.png" alt="icon" width={30} height={30} />
                        <h1 className='font-inter font-semibold'>Compliance & Security</h1>
                        <p className='text-base '>Stay compliant with encrypted transactions and KYC-ready processes.</p>
                    </div>

                </div>


                <div className='lg:w-[50%] flex gap-2 py-4 bg-[#F6F6F6] max-lg:flex-col max-lg:items-center max-lg:w-full  max-lg:gap-8'>
                    <div className="w-full flex flex-col gap-3 lg:max-w-[350px] justify-end px-4">
                        <Image src="/images/loan ico.png" alt="icon" width={30} height={30} />
                        <h1 className="font-inter font-semibold text-lg">Loan & Investment Control</h1>
                        <p>Offer loans and investment packages with full repayment and returns tracking.</p>
                    </div>

                    <Image src="/images/loan pic.png" alt="icon" width={300} height={300} className='lg:ml-auto flex items-end ' />

                </div>

            </motion.div>




            <motion.div
                className='bg-[#E9E6FF] flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Manage multiple wallets with ease</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Handle and manage live, loan, collection, and investment wallets all in one place.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                       <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/wallet pic.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />


                </div>

            </motion.div>



            <motion.div
                className='bg-[#150E46] flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <Image src="/images/investement pic.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

                <div className=' w-[90%] text-white lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Build financial products that scale</h1>

                    <p className="max-lg:text-center text-sm  sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Design loan, collection, and investment packages tailored to your users.</p>


                    <button
                        className="bg-white inline-flex h-[44px] items-center gap-3 justify-center text-[#4E37FB] font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                         <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>

            </motion.div>



            <motion.div
                className='bg-white flex py-20 mt-12  gap-10 items-center justify-center max-lg:flex-col'
                variants={fadeDown}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Stay on top of agent performance</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Track collections, remittances, and activities in real-time.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/agent p.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

            </motion.div>


            <motion.div
                className='bg-[#E9E6FF] flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeLeft}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <Image src="/images/charges pic.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Charges setup and application</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C]  sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Define service charges and apply them instantly across agents and users.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                         <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>

            </motion.div>


            <motion.div
                className='bg-white flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Full accountability with audit logs</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Every action is recorded, ensuring compliance and trust.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                         <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/audit pic.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

            </motion.div>

            <Footer />
        </div>
    )
}

export default Page;