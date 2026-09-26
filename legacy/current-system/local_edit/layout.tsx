import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Poppins, Lato  } from "next/font/google";
import "./globals.css";
import HeaderWrapper from "components/Headerwrapper";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic",],
  preload: true,
  display: "swap",
  variable: "--font-inter"
});


const lato = Lato({
  subsets: ["latin"],
  weight: ["100", "300", "400", "700", "900"],
  style: ["normal", "italic",],
  preload: true,
  display: "swap",
  variable: "--font-lato"
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  preload: true,
  display: 'swap',
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: "Alphakolect :: a Daily Contribution, Loans and Target Savings Mgt. solution for Microfinance Institutions.",
  keywords: ["finance", "app", "nextjs", "react"],
  description: "A modern web finance application",
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
