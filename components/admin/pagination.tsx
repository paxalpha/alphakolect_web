import React from 'react';
import Image from 'next/image';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  itemsPerPage: number;
}

const Pagination = ({ currentPage, totalPages, onPageChange, totalItems, itemsPerPage }: PaginationProps) => {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }

    return pages;
  };

  return (
    <div>
      <div className="flex flex-wrap flex-col md:flex-row pb-4 justify-between items-center gap-2 mt-4 px-2 md:px-5">
        {/* Prev Button */}
        <button
          onClick={handlePrevious}
          disabled={currentPage === 1}
          className={`flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center mb-2 md:mb-0 transition-colors ${
            currentPage === 1 
              ? 'opacity-50 cursor-not-allowed' 
              : 'hover:bg-gray-50 cursor-pointer'
          }`}
        >
          <Image src="/icons/left.svg" alt="Prev" width={10} height={10} className="mr-1" />
          Previous
        </button>

        {/* Page Numbers */}
        <div className="flex gap-2 items-center justify-center flex-wrap">
          <p className="text-sm text-gray-600 mr-2">
            Showing {startItem} to {endItem} of {totalItems}
          </p>
          {getPageNumbers().map((page, index) => (
            <button
              key={index}
              onClick={() => typeof page === 'number' ? onPageChange(page) : null}
              disabled={page === '...'}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                page === currentPage
                  ? 'bg-[#4E37FB] text-white font-semibold'
                  : page === '...'
                  ? 'cursor-default'
                  : 'hover:bg-gray-100 cursor-pointer'
              }`}
            >
              {page}
            </button>
          ))}
        </div>

        {/* Next Button */}
        <button
          onClick={handleNext}
          disabled={currentPage === totalPages}
          className={`flex items-center px-3 py-2 text-sm border border-[#D0D5DD] font-medium rounded-md w-full md:w-[100px] justify-center transition-colors ${
            currentPage === totalPages 
              ? 'opacity-50 cursor-not-allowed' 
              : 'hover:bg-gray-50 cursor-pointer'
          }`}
        >
          Next
          <Image src="/icons/right.svg" alt="Next" width={10} height={10} className="ml-1" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
