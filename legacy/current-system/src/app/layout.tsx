import type { Metadata, Viewport } from "next";
// import { Geist, Geist_Mono, Inter, Poppins, Lato  } from "next/font/google";
import "./globals.css";
import HeaderWrapper from "components/Headerwrapper";

// Fallback font objects to avoid Google Font fetch errors during build
const geistSans = { variable: "--font-geist-sans" };
const geistMono = { variable: "--font-geist-mono" };
const inter = { variable: "--font-inter" };
const lato = { variable: "--font-lato" };
const poppins = { variable: "--font-poppins" };

export const metadata: Metadata = {
  title: "Alphakolect :: a Daily Contribution, Loans and Target Savings Mgt. solution for Microfinance Institutions.",
  keywords: ["Alphakolect", "daily contribution", "loans", "savings", "finance", "microfinance"],
  description: "Alphakolect is a Daily Contribution, Loans (Microcredit) and Target Savings management solution.",
  icons: {
    icon: "/favicon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1.0,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${poppins.variable} ${lato.variable} antialiased`}
      >
     <HeaderWrapper />
        {children}
      </body>
    </html>
  );
}
