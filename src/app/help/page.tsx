"use client";
import React, { useState } from 'react'
import { motion } from "framer-motion"
import Footer from 'components/Footer';
import HelpSearch from './search';
import { helpCategories, contact } from 'components/data/helpdata';
import Link from "next/link";
import Image from 'next/image';
import { FaChevronRight } from "react-icons/fa";

const fadeUp = {
    hidden: { opacity: 0, y: 40 },
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

    const [search, setSearch] = useState("");

    const filtered = helpCategories.filter(cat =>
        cat.title.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div>
            <div className='bg-custom-143'>
                <motion.div
                    className="w-full max-w-3xl px-4 sm:px-6 flex flex-col gap-6 items-center m-auto pt-12 pb-20"
                    variants={fadeUp}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.7 }}
                >

                    <h1 className="font-inter text-white text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold text-center">How can we help?</h1>

                    <p className="text-white text-sm leading-relaxed font-inter font-medium text-center max-w-prose">Find answers, explore guides, and get support for your organization, agents, and customers.</p>

                    <HelpSearch onSearch={setSearch} />
                </motion.div>

            </div>



            <div className="px-8 lg:px-40 mt-6  ">

                {search.trim().length > 0 && (
                    <div className="text-sm text-gray-500 mt-3">
                        {filtered.length > 0 ? (

                            <>

                                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                                    <Link href="/help" className='font-inter font-semibold'>Help Center</Link>
                                    <FaChevronRight />
                                    <span className='text-sm'>Search result</span>
                                </div>

                                <hr />

                                <div className='flex gap-2 mt-3'>
                                    <span className="font-semibold text-lg">{filtered.length}</span>{" "}
                                    <span className='font-semibold text-lg'>result{filtered.length > 1 ? "s" : ""} found for{" "}</span>
                                    <span className="font-semibold text-lg">"{search}"</span>
                                </div>


                            </>
                        ) : (
                            <>
                                No results found for{" "}
                                <span className="font-semibold">"{search}"</span>
                            </>
                        )}
                    </div>
                )}
                <h1 className='font-inter font-semibold text-xl mt-8'>Categories</h1>


                <motion.div
                    className="grid md:grid-cols-3 gap-4 mt-4 "
                    variants={fadeLeft}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                >

                    {filtered.map((cat) => (
                        <Link
                            key={cat.slug}
                            href={`/help/${cat.slug}`}
                            className="p-4 border rounded-lg hover:bg-gray-50 transition h-full min-h-[100px] flex items-center gap-4"
                        >

                            <Image src={cat.icon} alt={cat.title} width={30} height={30} />
                            <div className="">
                                <h2 className="text-xl font-semibold">{cat.title}</h2>
                                <p className="text-sm text-gray-500 mt-1">{cat.text}</p>
                            </div>


                        </Link>
                    ))}
                </motion.div>

            </div>



            <div className="px-8 lg:px-40 mt-8 mb-12 ">
                <h1 className='font-inter font-semibold text-xl'>Contact & Support</h1>




                <motion.div
                  className="grid md:grid-cols-3 gap-4 mt-4 "
                    variants={fadeRight}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                >
                    {contact.map((cat, i) => (
                        <div
                            key={cat.title}
                            className="p-4 border rounded-lg hover:bg-gray-50 transition h-full min-h-[100px]"
                        >
                            <Image src={cat.icon} alt={cat.title} width={30} height={30} />
                            <h2 className="text-xl font-semibold">{cat.title}</h2>
                            <p className="text-sm text-gray-500 mt-1">{cat.text}</p>
                            {(i === 0) ?
                                <Link href="/" className='text-sm text-[#4E37FB]'>{cat.link}</Link> :
                                <p className="text-sm text-[#4E37FB] mt-1">{cat.link}</p>
                            }
                        </div>
                    ))}
                </motion.div>

            </div>

            <Footer />
        </div>
    )
}

export default Page