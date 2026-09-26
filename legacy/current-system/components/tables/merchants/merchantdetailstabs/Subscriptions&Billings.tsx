"use client"
import React from 'react'
import { useQuery } from '@tanstack/react-query';
import adminAPI from '../../../../src/app/admin/utilis/adminApi';

interface SubscriptionsProps {
  merchantId: string;
}

const Subscriptions_Billings = ({ merchantId }: SubscriptionsProps) => {

  // Fetch subscriptions from API
  const { data: subscriptionData, isLoading } = useQuery({
    queryKey: ['merchantSubscriptions', merchantId],
    queryFn: () => adminAPI.getMerchantSubscriptions(Number(merchantId)),
  });

  const subscription = subscriptionData?.data;

  return (
    <div className='bg-white dark:bg-gray-900 dark:text-white shadow-sm w-full p-[20px]'>
      <h2 className='text-[18px] font-inter font-semibold mb-4'>Subscription & Billing Information</h2>
      
      {isLoading ? (
        <div className='py-8 text-center text-gray-500'>
          Loading subscription data...
        </div>
      ) : !subscription ? (
        <div className='py-8 text-center text-gray-500'>
          No subscription data available
        </div>
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          <div className='border rounded-lg p-4'>
            <p className='text-[#93979F] text-[12px] font-inter mb-1'>Current Plan</p>
            <h3 className='font-inter text-[16px] font-semibold'>{subscription.currentPlan}</h3>
          </div>

          <div className='border rounded-lg p-4'>
            <p className='text-[#93979F] text-[12px] font-inter mb-1'>Status</p>
            <h3 className={`font-inter text-[16px] font-semibold ${subscription.status === 'Active' ? 'text-green-600' : 'text-red-600'}`}>
              {subscription.status}
            </h3>
          </div>

          <div className='border rounded-lg p-4'>
            <p className='text-[#93979F] text-[12px] font-inter mb-1'>Billing Cycle</p>
            <h3 className='font-inter text-[16px] font-semibold'>{subscription.billingCycle}</h3>
          </div>

          <div className='border rounded-lg p-4'>
            <p className='text-[#93979F] text-[12px] font-inter mb-1'>Next Billing Date</p>
            <h3 className='font-inter text-[16px] font-semibold'>
              {new Date(subscription.nextBillingDate).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </h3>
          </div>

          <div className='border rounded-lg p-4'>
            <p className='text-[#93979F] text-[12px] font-inter mb-1'>Payment Method</p>
            <h3 className='font-inter text-[16px] font-semibold'>{subscription.paymentMethod}</h3>
          </div>
        </div>
      )}

      <div className='mt-8'>
        <h3 className='text-[16px] font-inter font-semibold mb-4'>Billing History</h3>
        <div className='border rounded-lg p-6 text-center text-gray-500'>
          No billing history available yet
        </div>
      </div>
    </div>
  )
}

export default Subscriptions_Billings