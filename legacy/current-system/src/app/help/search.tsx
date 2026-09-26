"use client";
import { useState } from "react";
import { FaSearch } from 'react-icons/fa';


interface prop{
    onSearch:(query:string)=>void
}

export default function HelpSearch({ onSearch }: prop) {
    const [query, setQuery] = useState("");

    return (
        <>
            <div className='flex w-full justify-center max-sm:flex-col gap-4 max-sm:items-center'>
                <div className='w-full flex items-center px-4 max-w-md bg-white  rounded-md'>
                    <FaSearch className='text-black/70' />
                    <input
                        type="text"
                        placeholder='Search'
                        className='w-full max-w-md px-4 py-2 outline-none '
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            onSearch(e.target.value);
                        }}
                    />
                </div>
                <button className='px-4 py-2 bg-[#4E37FB] w-[50%] outline-none lg:w-32 text-white rounded-sm  transition-colors duration-200'>Search</button>
            </div>
        </>
    );
}
