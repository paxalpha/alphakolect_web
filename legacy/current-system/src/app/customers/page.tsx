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
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Customers can take control of their collections, loans, and investments.</h1>

                    <p className="max-lg:text-center text-sm  sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">With Alphakolect’s customer app, you can manage your money directly, track collections, repay loans, and grow investments with transparency and ease</p>

                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>

                <Image src="/images/customer.png" alt="agents" width={650} height={650} className='max-lg:w-[500px] ' />


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
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Personal wallet access</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Track balances across loans, collections, and investments in one place. No confusion, just clarity.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/customer1.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

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

                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <Image src="/images/customer2.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>

                <div className=' w-[90%] lg:max-w-[500px]  flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Digital collections</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Pay and record collections instantly. Every payment generates a confirmation.</p>


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
                variants={fadeLeft}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                <div className=' w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>
                    <h1 className="font-inter text-2xl  leading-tight md:leading-[1.2] font-bold max-lg:text-center">Secure interactions</h1>

                    <p className="max-lg:text-center text-sm text-[#60646C] sm:text-lg leading-relaxed font-inter font-medium  max-w-prose">Your financial activities are safe with bank-level security and verified institutions.</p>


                    <button
                        className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                      <Link href="/signup" className="text-sm md:text-base">Get started</Link>
                    </button>
                </div>


                <div className='w-[90%] lg:max-w-[500px] flex gap-3 flex-col max-lg:items-center'>

                    <Image src="/images/customer3.png" alt="financial" width={600} height={600} className='max-lg:w-[500px] ' />

                </div>
            </motion.div>

            <Footer />
        </div>
    )
}

export default Page