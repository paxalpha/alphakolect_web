"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { ClipLoader } from 'react-spinners';

export default function Login() {

  const schema = z.object({
    email: z.string().email({ message: "Invalid email address" }),
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters long" })
      .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
      .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
      .regex(/\d/, { message: "Password must contain at least one number" })
      .regex(/[@$!%*?&.#]/, { message: "Password must contain at least one special character" }),
  });

  type FormValues = z.infer<typeof schema>;

  const [showPassword, setShowPassword] = useState(false);

  function toggleShowPsw() {
    setShowPassword((prev) => !prev);
  }

  const router = useRouter()

  const loginUser = async (data: FormValues) => {
    // Import adminAPI dynamically to avoid SSR issues
    const { default: adminAPI, setAuthToken } = await import('./utilis/adminApi');
    
    const response = await adminAPI.login(data.email, data.password);
    
    // Store the token
    if (response.token) {
      setAuthToken(response.token);
    }
    
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
    mutationFn: loginUser,
    onSuccess: (data) => {
      console.log("Login successful:", data);
      
      // Store the token in localStorage
      if (data.token) {
        localStorage.setItem('adminToken', data.token);
      }
      
      // Store super admin info
      if (data.superAdmin) {
        localStorage.setItem('superAdmin', JSON.stringify(data.superAdmin));
      }
      
      reset();
      
      // Redirect to admin dashboard
      router.push('/admin/dashboard');
    },
    onError: (error: any) => {
      console.error("Login failed:", error.message);
    },
  });


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
        <h1 className="text-center font-inter text-[24px] font-semibold">Admin login</h1>
        <p className="text-center text-[16px] mt-2 font-inter text-gray-600">Login to your account to get started</p>

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

          {/* Password field */}
          <div>
          <div className="relative">
            <label className="form-label">Password</label>
            <input
              type={showPassword ? "text" : "password"}
              className="input-field"
              placeholder="********"
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

        
          <div className="">
            <Link href="/forgot-password" className="auth-link text-sm">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={mutation.isPending || !isValid}
            className={`auth-btn w-full  ${(!isValid || mutation.isPending) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {mutation.isPending ? <ClipLoader size={24} color="#ffffff" /> : "Login"}
          </button>

          {mutation.isError && (
            <p className="text-red-600 text-center mt-2">{(mutation.error as Error).message}</p>
          )}
          {mutation.isSuccess && (
            <p className="text-green-600 text-center mt-2">Login Successful!</p>
          )}

          <div className="text-center mt-5">
            <Link href="/merchant" className="auth-link text-sm">
              Switch to merchant login
            </Link>
          </div>
        </form>
      </div>
    </div>
  </div>
);

}