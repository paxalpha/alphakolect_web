"use client";
import React, { useState } from 'react';
import { motion } from "framer-motion";
import { Plus, Minus, Check } from "lucide-react";
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
            answer: "Alphakolect is a digital collection management platform that helps microfinance and collection organizations track field agents, log collections, manage customers, and generate accounting ledger reports.",
        },
        {
            question: "How does the 3-month free trial work?",
            answer: "All packages are completely free for the first 3 months from registration. No billing is made during this trial period. Starting from the 4th month, the system will invoice your account monthly based on the active agent count you configured.",
        },
        {
            question: "Do I need to pay or provide a credit card to register?",
            answer: "No. You select a package, register your account for free, and begin using the software. Payment features/funding are only required when the 3-month trial ends.",
        },
        {
            question: "What happens if my agent count changes?",
            answer: "Our billing system dynamically adjusts your package depending on the active agent count. For example, if you grow from 3 agents to 5 agents, you will automatically transition to the Growth Pack billing rate.",
        },
        {
            question: "Is there support available?",
            answer: "Yes! All plans include dedicated customer support via email and WhatsApp to assist you with onboarding and daily operations.",
        }
    ];

    const plansList = [
        {
            id: 1,
            name: "Starter Pack",
            price: "₦5,000",
            billing: "Billed monthly",
            desc: "For small microfinance setups starting digital collections.",
            agents: "1–3 Agents",
            features: [
                "Real-time collection logging",
                "Standard accounting tools",
                "Up to 3 active agent seats",
                "Multi branch and Multi User support",
                "Core reporting dashboard",
                "Email & WhatsApp support"
            ],
            popular: false
        },
        {
            id: 2,
            name: "Growth Pack",
            price: "₦10,000",
            billing: "Billed monthly",
            desc: "For growing teams expanding their collection outreach.",
            agents: "4–6 Agents",
            features: [
                "All Starter Pack features",
                "Up to 6 active agent seats",
                "Multi-branch management",
                "Multi branch and Multi User support",
                "Advanced analytics reports",
                "Priority support hotline"
            ],
            popular: false
        },
        {
            id: 3,
            name: "Mid-level",
            price: "₦15,000",
            billing: "Billed monthly",
            desc: "Ideal for established collection networks.",
            agents: "7–10 Agents",
            features: [
                "All Growth Pack features",
                "Up to 10 active agent seats",
                "Multi branch and Multi User support",
                "Custom commission matrix",
                "Extended history logs",
                "Dedicated account manager"
            ],
            popular: true // Most Popular
        },
        {
            id: 4,
            name: "Large",
            price: "₦40,000",
            billing: "Billed monthly",
            desc: "For large scale and high transaction volume firms.",
            agents: "10–20 Agents",
            features: [
                "All Mid-level features",
                "Up to 20 active agent seats",
                "Multi branch and Multi User support",
                "Full accounting suite",
                "Advanced integrations",
                "24/7 priority support"
            ],
            popular: false
        },
        {
            id: 5,
            name: "Enterprise",
            price: "Custom",
            billing: "Admin Managed",
            desc: "For massive deployments with custom requirements.",
            agents: "More than 20 Agents",
            features: [
                "Unlimited agent capacity",
                "Multi branch and Multi User support",
                "Custom feature builds",
                "Dedicated DB instance",
                "Custom API integrations",
                "Super Admin determined pricing"
            ],
            popular: false
        }
    ];

    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const toggle = (i: number) => {
        setOpenIndex(openIndex === i ? null : i);
    };

    const handleSelectPlan = (plan: typeof plansList[0]) => {
        localStorage.setItem("selectedPlan", JSON.stringify({ id: plan.id, name: plan.name }));
        window.location.href = `/signup?planId=${plan.id}&planName=${encodeURIComponent(plan.name)}`;
    };

    return (
        <>
            <div className='bg-[#150E46] pb-24 text-white min-h-screen'>
                <motion.div
                    className="w-full max-w-4xl px-4 sm:px-6 flex flex-col gap-5 items-center m-auto pt-16"
                    variants={fadeUp}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    transition={{ duration: 0.7 }}
                >
                    <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 text-xs font-semibold tracking-wider rounded-full uppercase">
                        Pricing Plans
                    </span>
                    <h1 className="font-inter text-3xl md:text-5xl leading-tight font-bold text-center">
                        Get that Needed Control
                    </h1>
                    <p className="text-sm leading-relaxed text-indigo-200 text-center max-w-xl">
                        Choose a package that fits your organization’s scale. Pay only for what you need. No upfront card payment required.
                    </p>

                </motion.div>

                {/* 3 Months Free Trial Banner */}
                <div className="max-w-4xl mx-auto px-6 mt-10">
                    <div className="bg-[#4E37FB]/25 border border-[#4E37FB]/40 rounded-2xl p-6 text-center backdrop-blur-sm shadow-xl">
                        <div className="flex items-center justify-center gap-2 text-indigo-300 font-bold text-lg">
                            <span>🎁</span>
                            <span>3-Month Free Trial Included!</span>
                        </div>
                        <p className="text-indigo-200 text-[13px] mt-2 leading-relaxed">
                            Every package is <strong>100% free for your first 3 months</strong>. Register now for free to enjoy full platform access. The system starts monthly billing from the 4th month onward based on the active agent count configured on your account.
                        </p>
                    </div>
                </div>

                {/* Grid Layout of Cards */}
                <div className='mt-16 px-6 max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 justify-center items-stretch'>
                    {plansList.map((plan) => (
                        <motion.div
                            key={plan.id}
                            className={`flex flex-col justify-between border rounded-2xl p-6 relative transition-all duration-300 ${
                                plan.popular
                                    ? 'bg-[#4E37FB] border-[#7A69FC] shadow-2xl scale-[1.03] z-10'
                                    : 'bg-[#1b1257] border-indigo-900/50 hover:border-indigo-500/40 shadow-lg'
                            }`}
                            variants={plan.popular ? fadeScale : (plan.id % 2 === 0 ? fadeUp : fadeLeft)}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true }}
                            transition={{ duration: 0.8 }}
                        >
                            {plan.popular && (
                                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#7A69FC] text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-full shadow-md uppercase">
                                    MOST POPULAR
                                </span>
                            )}

                            <div>
                                <h3 className='text-lg font-bold tracking-tight font-inter'>{plan.name}</h3>
                                <p className={`text-[12px] mt-1.5 min-h-[48px] leading-relaxed ${plan.popular ? 'text-indigo-100' : 'text-indigo-300'}`}>
                                    {plan.desc}
                                </p>
                                
                                <div className="mt-4 flex items-baseline gap-1">
                                    <span className='text-2xl font-extrabold font-inter tracking-tight'>{plan.price}</span>
                                    <span className={`text-[11px] font-medium ${plan.popular ? 'text-indigo-200' : 'text-indigo-400'}`}>
                                        /mo
                                    </span>
                                </div>
                                <p className={`text-[10px] font-semibold tracking-wide uppercase mt-1 ${plan.popular ? 'text-indigo-200' : 'text-indigo-400'}`}>
                                    {plan.agents}
                                </p>

                                <div className={`h-px my-5 ${plan.popular ? 'bg-indigo-400/30' : 'bg-indigo-900/50'}`} />

                                <ul className='flex flex-col gap-3 text-[12px] list-none'>
                                    {plan.features.map((feature, idx) => (
                                        <li key={idx} className="flex items-start gap-2">
                                            <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${plan.popular ? 'text-indigo-200' : 'text-indigo-400'}`} />
                                            <span className={plan.popular ? 'text-indigo-100' : 'text-indigo-200'}>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <button
                                onClick={() => handleSelectPlan(plan)}
                                className={`mt-8 w-full inline-flex h-[42px] items-center justify-center font-bold text-[13px] tracking-wide rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
                                    plan.popular
                                        ? 'bg-white text-[#4E37FB] hover:bg-indigo-50 shadow-lg'
                                        : 'bg-[#4E37FB] text-white hover:bg-indigo-600 shadow-sm'
                                }`}
                                aria-label={`Select ${plan.name}`}
                            >
                                Choose {plan.name}
                            </button>
                        </motion.div>
                    ))}
                </div>
            </div>

            <div className="mt-20 mb-20">
                <h2 className="font-inter text-2xl md:text-4xl leading-tight font-bold text-center text-black">
                    Frequently Asked Questions
                </h2>
                <div className="w-[90%] lg:w-[60%] m-auto mt-12">
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
                                <h3 className="font-semibold text-lg text-black">{faq.question}</h3>
                                <div className="text-[#4E37FB]">
                                    {openIndex === i ? <Minus /> : <Plus />}
                                </div>
                            </motion.div>

                            {openIndex === i && (
                                <p className="mt-3 text-gray-600 leading-relaxed text-sm">{faq.answer}</p>
                            )}
                        </div>
                    ))}
                </div>

                <p className="text-center m-auto w-[90%] md:w-[40%] mt-8 text-gray-500 text-sm">
                    Still have more questions? Please write to <span className="text-[#4E37FB] font-medium">support@alphakolect.com</span> and we will respond as quickly as we can.
                </p>
            </div>

            <Footer />
        </>
    );
};

export default Page;