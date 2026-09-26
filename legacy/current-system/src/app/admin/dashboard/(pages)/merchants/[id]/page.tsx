import React from 'react'
import MerchantDetails from './merchantsdetails';


const Page = async ({ params }: { params: Promise<{id: string}> }) => {
  const { id } = await params;
 
  return (
    <div>
      <MerchantDetails paramid={id} />
    </div>
  )
}

export default Page