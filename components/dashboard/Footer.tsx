import React from 'react';

const DashBoardFooter = () => {
  return (
    <div className="flex flex-col sm:flex-row h-[42px] w-full text-[12px] bg-black justify-between items-center px-6 text-white gap-2 sm:gap-0">
      <div className="flex gap-4">
        <p>Privacy Policy</p>
        <p>Terms of Use</p>
      </div>

      <p>© Alphakolect</p>
    </div>
  );
};

export default DashBoardFooter;