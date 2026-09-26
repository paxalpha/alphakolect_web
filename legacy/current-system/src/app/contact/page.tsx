"use client"

import Image from 'next/image'
import React from 'react'
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import Footer from 'components/Footer';


const Page = () => {


    const data = [
        {
            image: "/icons/hotline.svg",
            text1: "Hotline:",
            text2: "+234 6655 9090"
        },


        {
            image: "/icons/email.svg",
            text1: "Email",
            text2: "random@gmail.com"
        },


        {
            image: "/icons/message square.svg",
            text1: "SMS / Whatsapp",
            text2: "+234 6655 9090"
        },

    ]
    return (
        <div className='bg-custom-143'>

            <div className="flex flex-col justify-center lg:flex-row gap-8 pt-12 
                items-stretch  lg:px-28 px-8 mb-12">

                {/* LEFT SECTION */}
                <div className="flex-1 w-full lg:w-auto 
                    text-white flex flex-col gap-9 
                     rounded-lg">

                    <h1 className="text-4xl font-inter font-semibold">How can we help you?</h1>
                    <p className="text-sm">Let us know and we will get you what you need.</p>

                    <div className=" lg:max-w-[300px] bg-[#7A69FC] px-6 py-6 rounded-lg flex flex-col gap-4 ">

                    <p className='text-sm'>Hi, We are always here to help you.</p>

                    <div className="flex flex-col gap-4">
                        {data.map((map, i) => (
                            <div key={i} className="px-2 py-2 rounded-md bg-[#4E37FB] flex items-center gap-2">
                                <Image src={map.image} alt={map.text1} width={20} height={20} />
                                <div>
                                    <p className='text-sm'>{map.text1}</p>
                                    <p className='text-sm'>{map.text2}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <hr className="border-white/40" />

                    <p className='text-sm'>Connect with us</p>

                    <div className="flex items-center  gap-6">
                        <Image src="/icons/facebook.svg" alt="facebook" width={15} height={15} />
                        <Image src="/icons/insta.svg" alt="instagram" width={20} height={20} />
                        <Image src="/icons/twi ico.svg" alt="twitter" width={20} height={20} />
                        <Image src="/icons/tiktok.svg" alt="tiktok" width={20} height={20} />
                        <Image src="/icons/youtube.svg" alt="youtube" width={20} height={20} />
                    </div>
                    </div>
                </div>


                {/* RIGHT SECTION */}
                <div className="flex-1 w-full lg:w-auto 
                    bg-white px-6 py-6 rounded-lg 
                    flex flex-col gap-4">

                    <h1 className='text-xl font-inter font-semibold'>Send us a message</h1>
                    <p className='text-sm text-[#8E8E93]'>
                        Do you have a question? A complaint? Or need any help. Feel free to contact us.
                    </p>

                    <div className='flex gap-4'>
                        <div className='w-full'>
                            <label className='text-sm'>First Name</label>
                            <input type="text" className='w-full mt-2 p-2 rounded-md border outline-none text-sm'
                                placeholder='Enter your full name' />
                        </div>

                        <div className='w-full'>
                            <label className='text-sm'>Last Name</label>
                            <input type="text" className='w-full mt-2 p-2 rounded-md border outline-none text-sm'
                                placeholder='Enter your last name' />
                        </div>
                    </div>

                    <div className='flex gap-4'>
                        <div className='w-full'>
                            <label className='text-sm'>Email </label>
                            <input type="email" className='w-full mt-2 p-2 rounded-md border outline-none text-sm'
                                placeholder='Enter your email address' />
                        </div>

                        <div className='w-full'>
                            <label className='text-sm'>contact details</label>
                            <PhoneInput
                                country={'ng'}
                                containerClass="w-full mt-2"
                                inputClass="!w-full p-2 rounded-md border outline-none text-sm"
                                buttonClass="rounded-md"
                                dropdownClass="text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className='text-sm'>Message</label>
                        <textarea className='w-full mt-2 p-2 rounded-md border outline-none text-sm'
                            rows={4} placeholder='Type your message here'></textarea>
                    </div>

                    <button className="bg-[#4E37FB] text-white w-[200px] rounded-md px-4 py-2 m-auto mt-2 font-semibold">
                        Send Message
                    </button>
                </div>
            </div>

            <Footer />
        </div>
    )
}

export default Page