"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { ClipLoader } from 'react-spinners';

// Same rules as the backend (superAdminPasswordResetController.validateNewPassword)
const schema = z.object({
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .max(72, { message: "Password must be at most 72 characters long" })
    .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
    .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
    .regex(/\d/, { message: "Password must contain at least one number" })
    .regex(/[@$!%*?&.#]/, { message: "Password must contain at least one special character (@$!%*?&.#)" }),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormValues = z.infer<typeof schema>;

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Read the token once, then remove it from the address bar and browser history
  useEffect(() => {
    const fromUrl = searchParams.get("token");
    if (fromUrl) {
      setToken(fromUrl);
      window.history.replaceState(null, "", "/admin/reset-password");
    }
    setTokenChecked(true);
  }, [searchParams]);

  function toggleShowPsw() {
    setShowPassword((prev) => !prev);
  }

  const resetPassword = async (data: FormValues) => {
    // Import adminAPI dynamically to avoid SSR issues
    const { default: adminAPI, removeAuthToken } = await import('../utilis/adminApi');
    const response = await adminAPI.resetPassword(token as string, data.password);

    // All existing sessions are revoked by the reset; clear any stale one in this browser
    removeAuthToken();
    localStorage.removeItem('superAdmin');

    return response;
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isValid }, reset
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "all"
  });

  const mutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      reset();
    },
  });

  const onSubmit = (data: FormValues) => {
    mutation.mutate(data);
  };

  if (mutation.isSuccess) {
    return (
      <div className="mt-6 space-y-4 text-center">
        <p className="text-green-600">{mutation.data?.message}</p>
        <Link href="/admin" className="auth-btn w-full inline-block">
          Go to admin login
        </Link>
      </div>
    );
  }

  if (!tokenChecked) {
    return <div className="flex justify-center mt-6"><ClipLoader size={24} color="#4E37FB" /></div>;
  }

  if (!token) {
    return (
      <div className="mt-6 space-y-4 text-center">
        <p className="text-red-600">This reset link is invalid or incomplete.</p>
        <Link href="/admin/forgot-password" className="auth-link text-sm">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
      {/* New password field */}
      <div>
        <div className="relative">
          <label className="form-label">New password</label>
          <input
            type={showPassword ? "text" : "password"}
            className="input-field"
            placeholder="********"
            autoComplete="new-password"
            {...register("password")}
          />
          <div
            onClick={toggleShowPsw}
            className="absolute right-3 top-2/3 transform -translate-y-1/2 cursor-pointer"
          >
            {showPassword ? <FaEye className="text-gray-500" /> : <FaEyeSlash className="text-gray-500" />}
          </div>
        </div>
        <p className="text-red-500 text-sm mt-1">{errors?.password?.message}</p>
      </div>

      {/* Confirm password field */}
      <div>
        <label className="form-label">Confirm new password</label>
        <input
          type={showPassword ? "text" : "password"}
          className="input-field"
          placeholder="********"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        <p className="text-red-500 text-sm mt-1">{errors?.confirmPassword?.message}</p>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending || !isValid}
        className={`auth-btn w-full  ${(!isValid || mutation.isPending) ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {mutation.isPending ? <ClipLoader size={24} color="#ffffff" /> : "Reset password"}
      </button>

      {mutation.isError && (
        <div className="text-center mt-2 space-y-2">
          <p className="text-red-600">{(mutation.error as Error).message}</p>
          <Link href="/admin/forgot-password" className="auth-link text-sm">
            Request a new reset link
          </Link>
        </div>
      )}
    </form>
  );
}

export default function AdminResetPassword() {
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
        <h1 className="text-center font-inter text-[24px] font-semibold">Reset password</h1>
        <p className="text-center text-[16px] mt-2 font-inter text-gray-600">Choose a new password for your admin account</p>

        {/* useSearchParams requires a Suspense boundary in the App Router */}
        <Suspense fallback={<div className="flex justify-center mt-6"><ClipLoader size={24} color="#4E37FB" /></div>}>
          <ResetPasswordForm />
        </Suspense>

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
