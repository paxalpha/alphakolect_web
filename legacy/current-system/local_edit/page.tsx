"use client";
import React, { useState } from "react";
import Image from "next/image"
import { motion } from "framer-motion"
import { Plus, Minus } from "lucide-react";
import Footer from "components/Footer";
import Link from "next/link";


interface prop {
  title: string;
  name: string;
  description: string;
  image: string;
}

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

const fadeScale = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: { opacity: 1, scale: 1 }
};


export default function Home() {


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
      answer: "For support and enquiries, Send email to support@alphakolect.com or WhatsApp and calls via (234-9050226306)",
    },
  ];

  const data: prop[] = [
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi3.png"
    },

    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
    {
      title: "James Boluwatife",
      name: "CEO, Didan Microfinance",
      description: "“Alphakolect has simplified the way the local collection we use to know is handled. Now it is modernized. I love using the mobile app and the dashboard features”",
      image: "/images/avi.png"
    },
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => {
    setOpenIndex(openIndex === i ? null : i);
  };

  return (
    <div className="">

      <div className="flex flex-col items-center bg-custom-143">

        <motion.div
          className="w-full max-w-3xl mt-14 px-4 sm:px-6 flex flex-col gap-6 items-center text-white"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >

          <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold text-center">Powering <span className="text-[#CE9200]">Collections, Loans, and Investments </span> for Financial Institutions.</h1>

          <p className="text-base sm:text-lg md:text-xl leading-relaxed font-inter font-medium text-center max-w-prose">Manage agents, track customer savings, disburse loans, and grow investments, all in one secure platform. Gain real-time insights and streamline your processes for enhanced efficiency</p>

          <button
            className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
            aria-label="Get started"
          >
            <Link href="/signup" className="text-sm md:text-base">Get started</Link>
          </button>

        </motion.div>

        <motion.div
          className="mt-14 pb-6"
          variants={fadeRight}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
        >
          <Image src="/images/Rectangle 1053.png" alt="dashboard" width={800} height={800} className="max-lg:px-4" />
        </motion.div>
      </div>


      <div className="flex items-center justify-center gap-8 mt-14 max-lg:flex-col mb-[90px]">

        <div className="w-full flex flex-col gap-6 basis-1/2 max-lg:items-center">


          <motion.div
            className=" w-[300px] flex flex-col gap-3 max-lg:w-[80%] max-lg:text-center"
            variants={fadeLeft}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >

            <h1 className="font-inter text-lg md:text-2xl leading-tight md:leading-[1.8] font-bold "><span className="text-[#CE9200]">Tailored Solutions</span> for Financial Organizations</h1>
            <button
              className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] max-lg:m-auto lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
              aria-label="Get started"
            >
              <Link href="/signup" className="text-sm md:text-base">Get started</Link>
            </button>
          </motion.div>

          <div className="flex flex-col gap-6 ">

            <div className="flex items-center gap-4 max-lg:flex-col max-lg:gap-8">

              <motion.div
                className="w-[300px] max-lg:w-[90%] max-lg:border max-lg:p-2"
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >

                <Image src="/images/daily.svg" alt="daily" width={30} height={30} />

                <div className="flex flex-col gap-2 mt-4 ">
                  <h1 className="font-inter text-[21px] font-medium">Daily Collection Tracking</h1>
                  <p className="font-inter font-medium text-[16px]">Streamline your collection processes effortlessly</p>
                </div>

              </motion.div>
              <motion.div
                className="w-[300px] max-lg:w-[90%] max-lg:border max-lg:p-2"
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >

                <Image src="/images/stash_billing-info.svg" alt="daily" width={30} height={30} />

                <div className="flex flex-col gap-2 mt-4">
                  <h1 className="font-inter text-[21px] font-medium">Investment management</h1>
                  <p className="font-inter font-medium text-[16px]">Manage investments with ease and efficiency</p>
                </div>

              </motion.div>

            </div>



            <div className="flex items-center gap-4 max-lg:flex-col max-lg:gap-8">

              <motion.div
                className="w-[300px] max-lg:w-[90%] max-lg:border max-lg:p-2"
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >

                <Image src="/images/carbon_money.svg" alt="daily" width={30} height={30} />

                <div className="flex flex-col gap-2 mt-4">
                  <h1 className="font-inter text-[21px] font-medium">Customization Loan Management</h1>
                  <p className="font-inter font-medium text-[16px]">Flexible solutions for diverse lending needs and processes</p>
                </div>

              </motion.div>

              <motion.div
                className="w-[300px] max-lg:w-[90%] max-lg:border max-lg:p-2"
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >

                <Image src="/images/package.svg" alt="daily" width={30} height={30} />

                <div className="flex flex-col gap-2 mt-4">
                  <h1 className="font-inter text-[21px] font-medium">Packages Creation & Management</h1>
                  <p className="font-inter font-medium text-[16px]">Setup and customize your packages for collection, loan & investment</p>
                </div>

              </motion.div>

            </div>

          </div>

        </div>


        <Image src="/images/tailored.png" alt="tailoredsecion" width={300} height={300} className="max-sm:w-[80%] sm:w-[500px] lg:w-[300px]" />

      </div>

      <div className=" bg-[#150E46] p-4  pb-20 ">


        <motion.div
          className="flex flex-col gap-3 mt-12 text-center max-w-2xl mx-auto"
          variants={fadeScale}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <p className="text-[#BD8600] text-[22px] font-inter">How it works</p>
          <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold text-white">Getting Things Done Easily</h1>
          <p className="text-white">Effortlessly manage your financial operations with our platform.</p>
        </motion.div>

        <div className="flex items-start gap-6 justify-center mt-20 max-lg:flex-col max-lg:items-center max-lg:gap-20">


          <motion.div
            className="w-[95%] lg:max-w-[350px]  relative"
            variants={fadeLeft}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <h1 className="font-inter text-[40px] text-[#D1D1D1]  leading-none font-bold text-white text-center absolute left-1/2 -translate-x-1/2 -top-6 z-0">01</h1>

            <div className="bg-white p-5 flex flex-col gap-3 shadow-md rounded-md relative z-10 h-full min-h-[250px]">
              <Image src="/images/one.svg" alt="one" width={30} height={30} />
              <p className="text-[22px] font-inter font-semibold">Onboard Your Organization</p>
              <p className="text-[#878787] font-inter">Register, and set up branches. Easy onboarding of all agents, and customers of your organization.</p>
            </div>
          </motion.div>


          <motion.div
            className="w-[95%] lg:max-w-[350px]  relative"
            variants={fadeScale}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <h1 className="font-inter text-[40px] text-[#D1D1D1]  leading-none font-bold text-white text-center absolute left-1/2 -translate-x-1/2 -top-6 z-0">02</h1>

            <div className="bg-white p-5 flex flex-col gap-3 shadow-md rounded-md relative z-10 h-full min-h-[250px]">
              <Image src="/images/packages.svg" alt="one" width={30} height={30} />
              <p className="text-[22px] font-inter font-semibold">Create Packages</p>
              <p className="text-[#878787] font-inter">Create collection packages, investment packages and loan packages. Manage this packages and Customers on those packages.</p>
            </div>
          </motion.div>

          <motion.div
            className="w-[95%] lg:max-w-[350px]  relative"
            variants={fadeRight}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <h1 className="font-inter text-[40px] text-[#D1D1D1]  leading-none font-bold text-white text-center absolute left-1/2 -translate-x-1/2 -top-6 z-0">03</h1>

            <div className="bg-white p-5 flex flex-col gap-3 shadow-md rounded-md relative z-10 h-full min-h-[250px]">
              <Image src="/images/track.svg" alt="one" width={30} height={30} />
              <p className="text-[22px] font-inter font-semibold">Track Activity & Grow</p>
              <p className="text-[#878787] font-inter">With all things setup, manage customer, agents and their activities and sit down and relax while we make things easier for you and your staff.</p>
            </div>
          </motion.div>

        </div>
      </div>

      <motion.div
        className="mt-14 flex flex-col gap-3 text-center max-w-2xl mx-auto"
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        <p className="text-[#CFA235] font-inter text-[22px] font-semibold">Features</p>
        <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold">Features built for financial institutions</h1>
      </motion.div>


      <div className="flex items-center justify-center gap-6 mt-14 bg-[#FFF8E5] p-6 w-[90%] lg:w-[80%] xl:w-[70%] m-auto max-lg:flex-col rounded-md">

        <motion.div
          className="flex flex-col gap-2 mt-9 lg:mt-[100px] w-full lg:w-[450px] max-w-[450px] max-md:text-center"
          variants={fadeLeft}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h1 className="font-inter font-semibold text-xl sm:text-[22px] leading-tight sm:leading-[38px]">
            Effortlessly Manage Daily Customer Collections
          </h1>

          <p className="text-[#60646C] font-inter text-sm sm:text-[16px] leading-relaxed sm:leading-[24px]">
            Monitor and manage daily collections with ease. Our platform ensures accurate tracking of customer savings and agent performance.
          </p>
        </motion.div>

        <motion.div
          className="w-full lg:w-auto flex justify-center"
          variants={fadeRight}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <Image
            src="/images/Rectangle 1073.png"
            alt="one"
            width={450}
            height={450}
            className="w-full max-w-[450px] h-auto"
          />
        </motion.div>
      </div>

      <div className="flex justify-between gap-5 w-[90%] lg:w-[80%] xl:w-[70%] m-auto mt-6 max-lg:flex-col">

        {/* CARD 1 */}
        <div className="flex flex-col items-center justify-center gap-3 bg-[#F6EDFF] p-6 
                  flex-1 rounded-md">

          <motion.div
            className="w-full flex justify-center"
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <Image
              src="/images/Rectangle 1074.png"
              alt="one"
              width={450}
              height={450}
              className="w-full max-w-[450px] h-auto"
            />
          </motion.div>

          <div className="flex flex-col gap-2 w-full max-w-[450px] text-center lg:text-left">
            <h1 className="font-inter font-semibold text-xl sm:text-[20px] leading-tight sm:leading-[34px]">
              Simplify Loan Disbursements and Repayments
            </h1>

            <p className="text-[#60646C] font-inter text-sm sm:text-[16px] leading-relaxed sm:leading-[24px]">
              Easily manage loan disbursements, repayments, and balances. Our intuitive interface provides real-time insights into your loan portfolio.
            </p>
          </div>
        </div>


        {/* CARD 2 */}
        <div className="flex flex-col items-center justify-center gap-3 bg-[#ECFDF3] p-6 
                  flex-1 rounded-md">

          <motion.div
            className="w-full flex justify-center"
            variants={fadeDown}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <Image
              src="/images/Rectangle 1075.png"
              alt="one"
              width={450}
              height={450}
              className="w-full max-w-[450px] h-auto"
            />
          </motion.div>

          <div className="flex flex-col gap-2 w-full max-w-[450px] text-center lg:text-left">
            <h1 className="font-inter font-semibold text-xl sm:text-[20px] leading-tight sm:leading-[34px]">
              Create Custom Investment Solutions for Clients
            </h1>

            <p className="text-[#60646C] font-inter text-sm sm:text-[16px] leading-relaxed sm:leading-[24px]">
              Design and manage tailored investment packages with ease. Our platform ensures timely payouts and maximizes returns for your clients.
            </p>
          </div>
        </div>

      </div>



      <div className="flex items-center justify-center gap-6 mt-6 bg-[#F9F9F9] p-6 w-[90%] lg:w-[80%] xl:w-[70%] m-auto max-lg:flex-col rounded-md">

        <motion.div
          className="flex flex-col gap-2 mt-9 lg:mt-[100px] w-full lg:w-[450px] max-w-[450px] max-md:text-center"
          variants={fadeRight}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h1 className="font-inter font-semibold text-xl sm:text-[22px] leading-tight sm:leading-[38px]">
            Manage Multiple Wallets for Seamless Transactions
          </h1>

          <p className="text-[#60646C] font-inter text-sm sm:text-[16px] leading-relaxed sm:leading-[24px]">
            Utilize various wallets for collections, loans, and investments. Our system allows for easy fund transfers and reconciliations.
          </p>
        </motion.div>


        <motion.div
          className="w-full lg:w-auto flex justify-center max-md:text-center"
          variants={fadeRight}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <Image
            src="/images/Rectangle 1077.png"
            alt="one"
            width={450}
            height={450}
            className="w-full max-w-[450px] h-auto"
          />
        </motion.div>
      </div>

      <div className="flex flex-col items-center justify-center bg-[#E9E6FF] mt-12 gap-6 pb-8">


        <motion.div
          className="flex flex-col gap-3 text-center max-w-2xl mx-auto mt-12"
          variants={fadeRight}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <p className="text-[#BD8600] text-[22px] font-inter">How it works</p>
          <h1 className="font-inter text-2xl md:text-4xl leading-tight md:leading-[1.2] font-bold ">Getting Things Done Easily</h1>
          <p className="text-[#60646C]">Hear what our customer has to say about our services.</p>
        </motion.div>



        <div className="overflow-hidden w-full">
          <motion.div
            className="flex gap-4"
            animate={{
              x: ["0%", "-50%"],
            }}
            transition={{
              duration: 15,      // speed (increase to slow down)
              ease: "linear",
              repeat: Infinity,
            }}
          >
            {data.map((item, index) => (
              <div
                key={index}
                className="bg-white flex-shrink-0 flex flex-col gap-2 p-4 rounded-md w-[350px]"
              >
                <div className="flex items-center gap-2 mt-3">
                  <Image src={item.image} alt="quote" width={50} height={50} />
                  <div>
                    <p className="text-md">{item.title}</p>
                    <p className="text-sm text-[#60646C]">{item.name}</p>
                  </div>
                </div>

                <p className="text-sm text-[#4E37FB]">{item.description}</p>
              </div>
            ))}
          </motion.div>
        </div>


        {/* <div className="w-full flex gap-4  overflow-x-auto hide-scrollbar">
            {data.map((item, index) => (
              <div
                key={index}
                className="bg-white flex flex-col gap-2 p-4 h-auto rounded-md min-w-[350px]"
              >
                <div className="flex items-center gap-2 mt-3">
                  <Image src={item.image} alt="quote" width={50} height={50} />
                  <div>
                    <p className="text-md">{item.title}</p>
                    <p className="text-sm text-[#60646C]">{item.name}</p>
                  </div>
                </div>

                <p className="text-sm text-[#4E37FB]">
                  {item.description}
                </p>
              </div>
            ))}
         
        </div>*/}


        <button
          className="bg-[#4E37FB] inline-flex h-[44px] items-center gap-3 justify-center text-white font-medium rounded-md w-[70%] max-lg:m-auto lg:w-fit px-3 transition-colors duration-200 hover:brightness-90"
          aria-label="Get started"
        >
          <Link href="/signup" className="text-sm md:text-base">Get started</Link>
        </button>
      </div>

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

        <p className="text-center m-auto w-[90%] md:w-[60%] mt-4">Still have more questions? Please write to <span className="text-[#4E37FB]">support@alphakolect.com</span> or call/WhatsApp <span className="text-[#4E37FB]">09050226306</span> and we will respond as quickly as we can.</p>
      </div>

      <Footer />


    </div >
  );
}
