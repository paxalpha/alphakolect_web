"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { forgotPassword } from "../../../../services/api";
import '../../../../global.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const proceed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      Swal.fire({ icon: "warning", title: "Email required", text: "Please enter your email address." });
      return;
    }

    try {
      setIsLoading(true);
      const cleanEmail = String(email).trim().toLowerCase();
      await forgotPassword(cleanEmail);
      
      // Store email and flow for verify-otp and change-password pages
      localStorage.setItem('email', cleanEmail);
      localStorage.setItem('auth_flow', 'forgot-password');
      
      Swal.fire({ 
        icon: "success", 
        title: "OTP Sent", 
        text: "A reset code has been sent to your email." 
      });
      
      router.push("/verify-otp?flow=forgot-password");
    } catch (err: any) {
      Swal.fire({ 
        icon: "error", 
        title: "Request Failed", 
        text: err?.message || "Unable to send reset code. Please try again." 
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    document.body.style.backgroundImage = "url('/images/body-bg.png')";
    document.body.style.backgroundRepeat = "no-repeat";
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundColor = "#4E37FB";

    return () => {
        document.body.style.backgroundImage = "";
        document.body.style.backgroundRepeat = "";
        document.body.style.backgroundSize = "";
        document.body.style.backgroundPosition = "";
        document.body.style.backgroundColor = "";
    };
    }, []);

  return (
    <div className="w-full max-w-6xl mx-auto px-6">
      <div className="flex justify-center items-center h-screen">
        <div className="w-full md:w-5/12">
            <div className="item-card">
                <div className="flex justify-center">
                    <img src="/images/logo.png" alt="AlphaWeb Logo" />
                </div>
                <div className="card-body mt-3">
                    <h1 className="card-title text-center text-black">Forgot password</h1>
                    <p className="card-description text-center mt-2">Enter the email connected to your account.</p>
                    <form onSubmit={proceed} className="mt-5">
                        <div className="form-group">
                            <label htmlFor="email" className="form-label">Email</label>
                            <input type="email" id="email" 
                            className="input-field" 
                            placeholder="johndoe@gmail.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                             />
                        </div>
                        <div className="form-group mt-3">
                            <button 
                                type="submit" 
                                disabled={isLoading}
                                className={`auth-btn flex items-center justify-center gap-2 ${isLoading ? 'opacity-70' : ''}`}
                            >
                                {isLoading ? (
                                    <>
                                        <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        Sending...
                                    </>
                                ) : "Get OTP"}
                            </button>
                        </div>
                        <div className="form-group mt-3 text-center">
                            <Link href="/login" className="text-sm text-gray-600 hover:text-[#4E37FB]">Back to Login</Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
