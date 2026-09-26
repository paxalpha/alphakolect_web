/*
  Warnings:

  - A unique constraint covering the columns `[phoneNumber]` on the table `Agent` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "phoneNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Agent_phoneNumber_key" ON "Agent"("phoneNumber");
