import React from 'react'
import { FadeLoader } from "react-spinners";

const Loading = () => {
  // Detect dark mode using Tailwind's class on <body>
  const isDark = typeof window !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <div className='flex justify-center items-center mt-[100px]'>
      <FadeLoader color={isDark ? "#fff" : "#000"} />
    </div>
  )
}

export default Loading;