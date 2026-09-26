"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import '@/global.css';

export default function Login() {
  const [email, setEmail] = useState("");
  const router = useRouter();

  const proceed = async () => {
    if (!email) {
        alert("Please enter a valid email");
        return;
    }
    try {
        const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://alphakolect.com";
        const res = await fetch(`${BASE_URL}/collaborator/forgot-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (res.ok || data.success) {
            if (typeof window !== "undefined") {
                localStorage.setItem("resetEmail", email);
            }
            router.push("/collaborator/verify-otp");
        } else {
            alert(data.message || data.error || "Failed to send OTP. Please try again.");
            if (data.message === "Missing email; Email not found. Please sign-up again") {
                alert("Missing email; Email not found. Please sign-up again");
            }
        }
    } catch (err) {
        console.error("Error sending OTP", err);
        alert("An error occurred. Please try again.");
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
                    <img src="/images/logo.png" alt="" />
                </div>
                <div className="card-body mt-3">
                    <h1 className="card-title text-center text-black">Forgot password</h1>
                    <p className="card-description text-center mt-2">Enter the email connected to your account.</p>
                    <form action="" className="mt-5">
                        <div className="form-group">
                            <label htmlFor="email" className="form-label">Email</label>
                            <input type="email" id="email" 
                            className="input-field" 
                            placeholder="johndoe@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                             />
                        </div>
                        <div className="form-group mt-3">
                            <button type="button" onClick={proceed} className="auth-btn">Get OTP</button>
                        </div>
                        <div className="form-group mt-3 text-center">
                            <span className="text-sm">Didn't receive OTP?</span>&nbsp;&nbsp;
                            <Link href="/forgot-password" className="auth-link">Resend Otp</Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
