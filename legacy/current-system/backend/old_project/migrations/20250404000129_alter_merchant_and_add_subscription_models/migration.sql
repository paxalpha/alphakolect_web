/*
  Warnings:

  - Added the required column `updatedAt` to the `Merchant` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Currency" ADD COLUMN     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "accountIsVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMPTZ NOT NULL;

-- CreateTable
CREATE TABLE "MerchantSubscriptionInvoice" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "billedAmount" BIGINT NOT NULL,
    "billingCurrencyId" UUID NOT NULL,
    "settlementStatus" TEXT NOT NULL,
    "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "MerchantSubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSubscriptionHistory" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "amountPaid" BIGINT NOT NULL,
    "billingCurrencyId" UUID NOT NULL,
    "numberOfCyclesSettled" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantSubscriptionHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MerchantSubscriptionInvoice" ADD CONSTRAINT "MerchantSubscriptionInvoice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSubscriptionInvoice" ADD CONSTRAINT "MerchantSubscriptionInvoice_billingCurrencyId_fkey" FOREIGN KEY ("billingCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSubscriptionHistory" ADD CONSTRAINT "MerchantSubscriptionHistory_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSubscriptionHistory" ADD CONSTRAINT "MerchantSubscriptionHistory_billingCurrencyId_fkey" FOREIGN KEY ("billingCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
