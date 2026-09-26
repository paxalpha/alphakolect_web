"use client";
import React from 'react';

type LoadingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingText?: string;
  spinnerSize?: number;
};

export default function LoadingButton({
  loading = false,
  loadingText,
  spinnerSize = 16,
  children,
  className = '',
  disabled,
  ...rest
}: LoadingButtonProps) {
  return (
    <button
      disabled={loading || disabled}
      aria-busy={loading}
      className={`inline-flex items-center justify-center gap-2 transition-all duration-200 ${
        loading ? 'opacity-70 cursor-not-allowed' : ''
      } ${className}`}
      {...rest}
    >
      {loading && (
        <svg
          className="animate-spin"
          style={{ width: spinnerSize, height: spinnerSize }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      )}
      {loading ? loadingText ?? children : children}
    </button>
  );
}


