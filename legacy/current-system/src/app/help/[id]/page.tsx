import { helpCategories } from 'components/data/helpdata';
import Link from "next/link";
import FaqAccordion from "components/FaqAccordion";
import { FaChevronRight } from "react-icons/fa";
import Footer from 'components/Footer';

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const category = helpCategories.find(cat => cat.slug === id);

    if (!category) return <p>Category not found</p>;

    return (
        <>
        <div className="lg:px-20 px-6 py-6  mx-auto">

            <div className='flex flex-col gap-4'>

                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Link href="/help" className='font-inter font-semibold'>Help Center</Link>
                    <FaChevronRight />
                    <span>{category.title}</span>
                </div>

                <hr />
                <div className='flex flex-col gap-2'>
                <h1 className="text-xl font-semibold ">{category.title}</h1>
                <p className='text-sm'>{category.text}</p>
                 </div>
            </div>


            {/* FAQs */}
            <div className="flex flex-col gap-4 mt-6 ] lg:w-[60%] ">
                {category.faqs.map((faq) => (
                    <FaqAccordion key={faq.id} faq={faq} />
                ))}
            </div>

        </div>

        <Footer />
        </>
    );
}
