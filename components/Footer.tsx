"use client";
import React, { useState } from 'react'
import Image from "next/image"
import { motion } from "framer-motion"
import Link from 'next/link';

const Footer = () => {



    const fadeLeft = {
        hidden: { opacity: 0, x: -40 },
        visible: { opacity: 1, x: 0 }
    };

    const fadeRight = {
        hidden: { opacity: 0, x: 40 },
        visible: { opacity: 1, x: 0 }
    };



    const [date, setDate] = useState(new Date())

    function footer() {
        let day = date.getFullYear()
        return day
    }
    return (
        <div>

            <div className="bg-[#4E37FB] p-10 ">

                <motion.div
                    className=" w-full lg:w-[90%] flex items-center max-lg:flex-col justify-between max-lg:text-center max-lg:gap-4 m-auto"
                    variants={fadeLeft}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                >

                    <div className=" flex flex-col gap-2">
                        <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold text-white">Take Control of Your Finances</h1>
                        <p className="text-white font-inter text-sm">Experience the power of Alphakolect with a personalized demo or start your free trial today.</p>
                    </div>

                    <button
                        className="bg-white inline-flex h-[44px] items-center gap-3 justify-center font-medium rounded-md w-[70%] max-lg:m-auto lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
                        aria-label="Get started"
                    >
                        <Link href="/signup" className="text-sm md:text-base text-[#4E37FB]">Get started</Link>
                    </button>
                </motion.div>

            </div>

            <div className="bg-black p-8 ">


                <motion.div
                    className="flex justify-between max-md:flex-col max-md:gap-6"
                    variants={fadeRight}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                >

                    <div className="flex flex-col lg:w-[350px] gap-6">
                        <div className="flex items-center gap-2">
                            <Image src="/images/logo.png" alt="logo" width={30} height={30} />
                            <p className="text-white">Alphakolect</p>
                        </div>

                        <p className="text-white">Design amazing digital experiences that create more happy in the world.</p>
                    </div>


                    <div className="flex flex-col gap-2">
                        <p className="text-[#4E37FB]">Get the app</p>
                        <Image src="/images/app.png" alt="apple" width={100} height={100} />
                        <Image src="/images/and.png" alt="apple" width={100} height={100} />
                    </div>

                </motion.div>

                <div className="mt-8">
                    <ul className="flex gap-4 text-white max-md:flex-col ">
                        <li>Overview</li>
                        <li>Features</li>
                        <li>Pricing</li>
                        <li>Careers</li>
                        <li>Help</li>
                        <li>Privacy</li>
                    </ul>
                </div>

                <hr className="bg-[#FFFFFF] mt-14" />

                <div className=" flex justify-between mt-6 max-md:flex-col max-md:gap-4 items-center">
                    <p className="text-white">{footer()} Untitled UI. All rights reserved.</p>
                    <div className="flex items-center gap-4">
                        <Image src="/icons/x ico.svg" alt="x" width={20} height={20} />
                        <Image src="/icons/linkdn ico.svg" alt="link" width={20} height={20} />
                        <Image src="/icons/facebook ico.svg" alt="facebook" width={20} height={20} />
                        <Image src="/icons/github ico.svg" alt="github" width={20} height={20} />
                        <Image src="/icons/twi ico.svg" alt="twitter" width={20} height={20} />
                        <Image src="/icons/ball ico.svg" alt="ball" width={20} height={20} />
                    </div>
                </div>

            </div>
        </div>
    )
}

export default Footer