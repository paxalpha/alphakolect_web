"use client";
import { usePathname } from "next/navigation";
import Header from "./Header";

export default function HeaderWrapper() {
  const pathname = usePathname();

  // Hide header for all dashboard pages
  const hideHeader = pathname.startsWith("/dashboard") || pathname === "/login" || pathname === "/signup" || pathname === "/verify-otp" || pathname.startsWith("/admin") 

  if (hideHeader) return null;

  return <Header />;
}
