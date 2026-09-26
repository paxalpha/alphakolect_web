"use client"
import React from 'react'
import Footer from 'components/Footer'
import Image from 'next/image'
import { motion } from "framer-motion"
import Link from 'next/link'

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
                className='bg-custom-143 flex py-20  gap-10 items-center justify-end max-lg:flex-col'
                variants={fadeLeft}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className=' w-[90%] lg:max-w-[500px] text-white flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Manage collections <span className='text-[#CE9200]'>on the go</span> by Agents</h1>

                    <p className="max-lg:text-center text-sm  sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">With the agent app, you can collect payments, manage customers, and stay on top of your targets, all from your phone.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>

                <Image src="/images/agents hero.png" alt="agents" width={650} height={650} className='max-lg:w-[500px] ' />
            </motion.div>






            <motion.div
                className='bg-white flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeRight}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Customer management on the go</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">View customer details, history, and collections anytime. Stay organized and handle multiple customers with ease.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/agent2.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

            </motion.div>






            <motion.div
                className='bg-[#150E46] flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeLeft}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <Image src="/images/agent3.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

                <div className=' w-[90%] lg:max-w-[500px] text-white flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Collection tracking</h1>

                    <p className="max-lg:text-center text-sm  sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Record payments instantly. Every transaction is accurate and stored securely.</p>


                    <button
                        className="bg-white inline-flex h-[44px] items-center gap-3 justify-center text-[#4E37FB] font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
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
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Offline support</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Work without internet. Transactions are saved and sync automatically when you’re back online.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/agent4.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

            </motion.div>






            <motion.div
                className='bg-[#E9E6FF] flex py-20 mt-12  gap-10 items-center justify-center  max-lg:flex-col'
                variants={fadeRight}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >

                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <Image src="/images/agent5.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

                <div className=' w-[90%] lg:max-w-[500px]  flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Remittance updates</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">See your total collections and pending remittances at a glance. Stay accountable with clear breakdowns.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>
            </motion.div>

            <Footer />
        </div>
    )
}

export default Page