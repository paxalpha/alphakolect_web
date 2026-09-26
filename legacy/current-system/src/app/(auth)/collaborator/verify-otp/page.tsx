"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import Swal from "sweetalert2";
import { collaboratorVerifyOtp, collaboratorResendOtp } from "../../../../../services/api";
import '../../../../../global.css'; 

export default function VerifyOtp() {
  const [otp, setOtp] = useState(new Array(6).fill(""));
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const inputRefs:any = useRef([]);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const fullOtp = otp.join("").trim();
    if (fullOtp.length !== 6) {
      Swal.fire({ icon: "warning", title: "Invalid OTP", text: "Please enter the 6-digit OTP." });
      return;
    }
    if (!email) {
      Swal.fire({ icon: "error", title: "Missing email", text: "Email not found. Please start over." });
      return;
    }
    try {
      setIsLoading(true);
      await collaboratorVerifyOtp(email, fullOtp);
      await Swal.fire({ icon: "success", title: "Verified", text: "Email verified successfully." });
      router.push('/collaborator/change-password');
    } catch (err:any) {
      Swal.fire({ icon: "error", title: "Verification failed", text: err?.message || 'Unable to verify OTP' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      Swal.fire({ icon: "error", title: "Missing email", text: "Email not found. Please start over." });
      return;
    }
    try {
      await collaboratorResendOtp(email);
      Swal.fire({ icon: "success", title: "OTP resent", text: `A new OTP has been sent to ${email}.` });
    } catch (err:any) {
      Swal.fire({ icon: "error", title: "Resend failed", text: err?.message || 'Unable to resend OTP' });
    }
  };

  const handleChange = (e:any, index:any) => {
    const { value } = e.target;
    if (/[^0-9]/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (e:any, index:any) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  useEffect(() => {
    const savedEmail = typeof window !== 'undefined' ? localStorage.getItem('collaborator_email') : null;
    if (savedEmail) setEmail(savedEmail);
    
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
          <div className="bg-white p-8 rounded-lg shadow-xl">
            <div className="flex justify-center">
              <img src="/images/logo.png" alt="Company Logo" />
            </div>
            
            <div className="mt-6">
              <h1 className="text-3xl font-bold text-center text-gray-800">Enter OTP</h1>
              <p className="text-center text-gray-500 mt-2">
                Enter the OTP sent to <span className="font-semibold text-gray-700">{email}</span>
              </p>
              
              {/* OTP input form */}
              <form onSubmit={handleVerify} className="mt-8">
                <div className="flex justify-center space-x-2" >
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el:any) => (inputRefs.current[index] = el)}
                      type="text"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleChange(e, index)}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      className="w-10 h-12 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 transition duration-200"
                    />
                  ))}
                </div>

                <div className="mt-8">
                  <button 
                    type="submit" 
                    disabled={isLoading}
                    className={`w-full py-3 px-4 bg-[#4E37FB] text-white font-bold rounded-lg transition duration-200 shadow-md ${isLoading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                  >
                    {isLoading ? "Verifying..." : "Verify"}
                  </button>
                </div>
                
                <div className="mt-6 text-center">
                  <span className="text-sm text-gray-600">Didn't receive OTP?</span>
                  &nbsp;&nbsp;
                  <button type="button" onClick={handleResend} className="text-[#4E37FB] hover:underline font-medium">
                    Resend OTP
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
