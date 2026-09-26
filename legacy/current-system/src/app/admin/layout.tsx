import type { Metadata } from "next";
// import { Geist, Geist_Mono, Inter, Poppins, Lato } from "next/font/google";
import "./global2.css";
import ReactQueryProvider from "../../../libs/react-query-provider";

const geistSans = { variable: "--font-geist-sans" };
const geistMono = { variable: "--font-geist-mono" };
const inter = { variable: "--font-inter" };
const lato = { variable: "--font-lato" };
const poppins = { variable: "--font-poppins" };

export const metadata: Metadata = {
  title: "AlphaWeb Supa-Admin",
  description: "A modern web finance application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`
          ${geistSans.variable}
          ${geistMono.variable}
          ${inter.variable}
          ${lato.variable}
          ${poppins.variable}
          antialiased
          transition-colors
          duration-500
        `}
      >
        <ReactQueryProvider>
          {children}
        </ReactQueryProvider>
      </body>
    </html>
  );
}
