/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `Currency` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "SystemAdmin" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "profileImageUrl" TEXT,

    CONSTRAINT "SystemAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemAdmin_email_key" ON "SystemAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");
