"use client";
import { useState } from "react";
import { faqss } from "components/data/helpdata";
import { motion } from "framer-motion"
import { Plus, Minus } from "lucide-react";


const fadeLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0 }
};

export default function FaqAccordion({ faq }: { faq: faqss }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t rounded-md p-4 cursor-pointer">
      <motion.div
        variants={fadeLeft}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex justify-between items-center text-left"
        >
          <span className="font-medium">{faq.question}</span>
          <div className="">
            {open ? <Minus /> : <Plus />}
          </div>
        </button>
      </motion.div>

      {open && (
        <p className="text-sm text-gray-600 mt-3">
          {faq.answer}
        </p>
      )}
    </div>
  );
}
