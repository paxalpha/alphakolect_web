"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { registerUser } from "../../../../services/api";
import '../../../../global.css';

const westAfricanCurrencies = [
  "XOF", // Benin
  "XOF", // Burkina Faso
  "CVE", // Cabo Verde
  "XOF", // Côte d'Ivoire
  "GMD", // The Gambia
  "GHS", // Ghana
  "GNF", // Guinea
  "XOF", // Guinea-Bissau
  "LRD", // Liberia
  "XOF", // Mali
  "MRU", // Mauritania
  "XOF", // Niger
  "NGN", // Nigeria
  "XOF", // Senegal
  "SLL", // Sierra Leone
  "XOF"  // Togo
];

export default function SignUp() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [buttonState, setButtonState] = useState<'idle' | 'loading' | 'success'>('idle');

  const [businessName, setBusinessName] = useState("");
  const [businessAlias, setBusinessAlias] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("N (NGN)");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<{ id: number; name: string } | null>(null);
  const router = useRouter();

  const signup = async () => {
    if (isLoading) return;
    if (!businessName || !businessAlias || !phoneNumber || !email || !currency || !password || !confirmPassword) {
      Swal.fire({ icon: "warning", title: "All fields are required", text: "Please fill in all fields." });
      return;
    }
    if (password !== confirmPassword) {
      Swal.fire({ icon: "warning", title: "Passwords do not match", text: "Please make sure both passwords are the same." });
      return;
    }
    setIsLoading(true);
    setButtonState('loading');
    try {
      const userData = {
        businessName,
        businessAlias,
        phoneNumber,
        email,
        currency,
        password,
        confirmPassword,
        planId: selectedPlan?.id || 1
      };
      const result = await registerUser(userData);
      localStorage.setItem('email', email);
      setButtonState('success');
      Swal.fire({
        icon: "success",
        title: "Registration Successful",
        text: result.message || "Please check your email for OTP verification.",
        showConfirmButton: false,
        timer: 2000
      });
      setTimeout(() => { router.push('/verify-otp'); }, 2000);
    } catch (error: any) {
      setButtonState('idle');
      Swal.fire({ icon: "error", title: "Registration Failed", text: error?.message || "An error occurred during registration." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPlanId = params.get("planId") || params.get("plan");
    const urlPlanName = params.get("planName");

    let finalPlan: { id: number; name: string } | null = null;

    if (urlPlanId) {
      const id = parseInt(urlPlanId) || 1;
      let name = urlPlanName || "Starter Pack";
      if (id === 1) name = "Starter Pack";
      else if (id === 2) name = "Growth Pack";
      else if (id === 3) name = "Mid-level Pack";
      else if (id === 4) name = "Large Pack";
      else if (id === 5) name = "Enterprise Pack";
      finalPlan = { id, name };
    } else {
      const stored = localStorage.getItem("selectedPlan");
      if (stored) {
        try {
          finalPlan = JSON.parse(stored);
        } catch (e) {
          // ignore
        }
      }
    }

    if (!finalPlan) {
      Swal.fire({
        icon: "warning",
        title: "No Package Selected",
        text: "Please select a package first to continue with registration.",
        confirmButtonColor: "#4E37FB"
      }).then(() => {
        router.push("/pricing");
      });
    } else {
      setSelectedPlan(finalPlan);
      localStorage.setItem("selectedPlan", JSON.stringify(finalPlan));
    }
  }, [router]);
  return (
    <div className="flex flex-col md:flex-row w-full h-screen overflow-hidden">
      <div className="w-full md:w-6/12 auth-side-bg h-screen hidden md:flex items-center justify-center">
        <div>
          <img src="/images/dashboard.png" className="dashboard-img" />
          <div>
            <p className="welcome-text text-center">Stay on top of all <br /> manual collections</p>
            <p className="welcome-desc text-center">Monitor and manage all agents and customers <br /> collections and their activities</p>
          </div>
        </div>
      </div>
      
      <div className="w-full md:w-6/12 flex flex-col min-h-screen px-4 overflow-y-auto">
        <div className="flex flex-col flex-grow justify-center py-10">
          <div className="item-card">
            <div className="flex justify-center">
              <img src="/images/logo.png" alt="" />
            </div>
            <div className="card-body mt-3">
               <h1 className="card-title text-center text-black">Signup to Alphakolect</h1>
               {selectedPlan && (
                 <div className="mt-2 text-center">
                   <span className="inline-block px-3 py-1 bg-indigo-50 border border-indigo-100 text-[#4E37FB] text-xs font-semibold rounded-full">
                     Plan: {selectedPlan.name}
                   </span>
                 </div>
               )}
               <p className="card-description text-center mt-2">Fill the form below to get started</p>
              <form action="">
                    <div className="form-group">
                        <label htmlFor="name" className="form-label">Business name</label>
                        <input 
                        type="text" 
                        id="name" 
                        className="input-field" 
                        placeholder="Business Name" 
                        value={businessName} 
                        onChange={(e) => setBusinessName(e.target.value)}
                        />
                    </div>
                    <div className="form-group mt-3">
                        <label htmlFor="alias" className="form-label">Business alias</label>
                        <input 
                        type="text" 
                        id="alias" 
                        className="input-field" 
                        placeholder="Business Alias" 
                        value={businessAlias}
                        onChange={(e) => setBusinessAlias(e.target.value)}
                        />
                    </div>
                    <div className="form-group mt-3">
                        <label htmlFor="phone" className="form-label">Phone number</label>
                        <input 
                        type="tel" 
                        id="phone" 
                        inputMode="numeric" 
                        className="input-field" 
                        placeholder="Business Number"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        />
                    </div>
                    <div className="form-group mt-3">
                        <label htmlFor="email" className="form-label">Email</label>
                        <input 
                        type="email" 
                        id="email" 
                        className="input-field" 
                        placeholder="Business Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div className="form-group mt-3 relative">
                        <label className="form-label">Currency</label>
                        <select 
                        className="input-field pr-10 appearance-none"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        >
                        <option value="">Select Currency</option>
                        {westAfricanCurrencies.map((code, idx) => (
                          <option key={`${code}-${idx}`} value={code}>{code}</option>
                        ))}
                        </select>
                        <div className="pointer-events-none absolute right-3 top-9 flex items-center">
                        <img src="/icons/arrow-down.png" className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="form-group mt-3 relative">
                        <label className="form-label">Password</label>
                        <input 
                        type={showPassword ? "text" : "password"} 
                        className="input-field" 
                        placeholder="********"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        />
                        <div onClick={() => setShowPassword((prev) => !prev)} className="flex justify-end icon-up">
                        <img src={showPassword ? "/icons/show.png" : "/icons/hide.png"} className="hide-icon" />
                        </div> 
                    </div>
                    <div className="form-group mt-4 relative">
                        <label className="form-label">Confirm Password</label>
                        <input 
                        type={showPassword ? "text" : "password"} 
                        className="input-field" 
                        placeholder="********"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        <div onClick={() => setShowPassword((prev) => !prev)} className="flex justify-end icon-up">
                        <img src={showPassword ? "/icons/show.png" : "/icons/hide.png"} className="hide-icon" />
                        </div> 
                    </div>
                    <div className="form-group mt-4">
                        <button 
                            type="button" 
                            className={`auth-btn ${buttonState === 'loading' ? 'loading' : ''} ${buttonState === 'success' ? 'success' : ''}`}
                            onClick={signup}
                            disabled={isLoading}
                        >
                            {buttonState === 'loading' ? 'Creating Account...' : buttonState === 'success' ? 'Success!' : 'Continue'}
                        </button>
                    </div>
                    <div className="form-group mt-3 text-center">
                        <span className="text-sm">Already have an account? </span>&nbsp;&nbsp;
                        <Link href="/login" className="auth-link">Login</Link>
                    </div>
                </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
