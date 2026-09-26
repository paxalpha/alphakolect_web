import React from 'react';

const DashBoardFooter = () => {
  return (
    <div className="flex flex-wrap h-[42px] w-full text-[12px] bg-black dark:bg-gray-900 dark:border dark:border-gray-500 justify-between items-center px-6 text-white gap-2 sm:gap-0">
      <div className="flex gap-4">
        <p>Privacy Policy</p>
        <p>Terms of Use</p>
      </div>

      <p>© Alphakolect</p>
    </div>
  );
};

export default DashBoardFooter;