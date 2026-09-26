"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ClipLoader } from 'react-spinners';

export default function AdminForgotPassword() {

  const schema = z.object({
    email: z.string().email({ message: "Invalid email address" }),
  });

  type FormValues = z.infer<typeof schema>;

  const requestReset = async (data: FormValues) => {
    // Import adminAPI dynamically to avoid SSR issues
    const { default: adminAPI } = await import('../utilis/adminApi');
    return adminAPI.forgotPassword(data.email);
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isValid }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "all"
  });

  const mutation = useMutation({ mutationFn: requestReset });

  const onSubmit = (data: FormValues) => {
    mutation.mutate(data);
  };

return (
  <div className="relative min-h-screen w-full bg-[#4E37FB]">
    {/* Background image layer */}
    <div
      className="absolute inset-0 bg-[url('/images/body-bg.png')] bg-no-repeat bg-cover bg-center"
      style={{ backgroundAttachment: 'fixed' }}
    />

    {/* Content layer */}
    <div className="relative z-10 flex justify-center items-center min-h-screen px-4">
      <div className="w-full max-w-[450px] shadow-lg bg-white rounded-md p-6">
        <div className="flex justify-center mb-4">
          <img src="/images/logo.png" alt="logo" className="w-[50px]" />
        </div>
        <h1 className="text-center font-inter text-[24px] font-semibold">Forgot password</h1>
        <p className="text-center text-[16px] mt-2 font-inter text-gray-600">
          Enter your admin email and we&apos;ll send you a link to reset your password
        </p>

        {mutation.isSuccess ? (
          <div className="mt-6 space-y-4">
            <p className="text-green-600 text-center">{mutation.data?.message}</p>
            <p className="text-center text-sm text-gray-600">
              The link expires in 30 minutes. Check your spam folder if it doesn&apos;t arrive.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            {/* Email field */}
            <div>
              <label htmlFor="email" className="form-label">Email</label>
              <input
                type="email"
                id="email"
                className="input-field"
                placeholder="johndoe@gmail.com"
                {...register("email")}
              />
              <p className="text-red-500 text-sm mt-1">{errors?.email?.message}</p>
            </div>

            <button
              type="submit"
              disabled={mutation.isPending || !isValid}
              className={`auth-btn w-full  ${(!isValid || mutation.isPending) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {mutation.isPending ? <ClipLoader size={24} color="#ffffff" /> : "Send reset link"}
            </button>

            {mutation.isError && (
              <p className="text-red-600 text-center mt-2">{(mutation.error as Error).message}</p>
            )}
          </form>
        )}

        <div className="text-center mt-5">
          <Link href="/admin" className="auth-link text-sm">
            Back to admin login
          </Link>
        </div>
      </div>
    </div>
  </div>
);

}
