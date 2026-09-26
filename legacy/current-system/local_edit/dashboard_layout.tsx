"use client"
import React, {useState, useEffect} from 'react';
import DashboardHeader from '../components/dashboard/Header';
import DashBoardSidebar from '../components/dashboard/Sidebar';
import DashBoardFooter from '../components/dashboard/Footer';
import { getMerchantSubscription } from '@/services/api';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMerchantSubscription()
      .then(res => {
        setSubscription(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const isBlocked = subscription?.status === 'Blocked';

  return (
    <div className="flex flex-col h-screen w-full relative">
      {/* header  */}
      <DashboardHeader setIsOpen={setIsOpen} isOpen={isOpen} />
    
      <div className="flex flex-1 overflow-hidden">
       {/* Sidebar  */}
       <DashBoardSidebar setIsOpen={setIsOpen} isOpen={isOpen} />

       <div className='flex flex-col flex-1 min-w-0 bg-[#EBEBEB]'>
        <main   className=" flex-1 overflow-y-auto p-4 pt-[80px] antialiased ">
          {isBlocked ? (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8 text-center border-t-4 border-red-500">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m11-3.5a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Subscription Suspended</h2>
                <p className="text-gray-600 mb-6">
                  Your access has been temporarily blocked due to an outstanding balance of 
                  <span className="font-bold text-red-600"> ₦{parseFloat(subscription.totalDebt).toLocaleString()}</span>. 
                  Please fund your wallet to reactivate your dashboard.
                </p>
                <div className="space-y-3">
                   <Link href="/dashboard/wallet" onClick={() => window.location.href='/dashboard/wallet'} className="block w-full bg-[#4E37FB] text-white font-bold py-3 rounded-lg hover:bg-[#3d29cc] transition-colors">
                    Go to Wallet & Pay
                  </Link>
                   <Link href="/dashboard/subscription" onClick={() => window.location.href='/dashboard/subscription'} className="block w-full text-sm text-gray-500 hover:text-gray-700 underline">
                    View Subscription Details
                  </Link>
                </div>
              </div>
            </div>
          ) : children}
        </main>

        <DashBoardFooter />
        </div>

      </div>
    </div>
  );
}
