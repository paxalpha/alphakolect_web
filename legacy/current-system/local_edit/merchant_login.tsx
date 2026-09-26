"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { loginUserWithEmail } from "@/services/api";
import '@/global.css';

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [buttonState, setButtonState] = useState<'idle' | 'loading' | 'success'>('idle');
  const router = useRouter();

  const login = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setButtonState('loading');
    try {
      const userData = { email, password };
      const authenticated: any = await loginUserWithEmail(userData);
      if (authenticated) {
        window.localStorage.setItem("user", JSON.stringify({
          ...authenticated.merchant,
          token: authenticated.token
        }));
        setButtonState('success');
        setTimeout(() => {
          router.push("/dashboard");
        }, 1500);
      } else {
        setButtonState('idle');
        Swal.fire({
          icon: "error",
          title: "Invalid email or password",
          text: "Please check your credentials and try again."
        });
      }
    } catch (error: any) {
      setButtonState('idle');
      Swal.fire({
        icon: "error",
        title: "Login Error",
        text: error?.message || "An error occurred during login."
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
                    <img src="/images/logo.png" alt="" />
                </div>
                <div className="card-body mt-3">
                    <h1 className="card-title text-center text-black">Merchant login</h1>
                    <p className="card-description text-center mt-2">Login to your account to get started</p>
                    <form action="">
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
                            <label className="form-label">Password</label>
                            <input type={showPassword ? "text" : "password"} 
                            className="input-field" 
                            placeholder="********"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            />
                            <div onClick={() => setShowPassword((prev) => !prev)} className="flex justify-end icon-up">
                                <img src={
                                    showPassword
                                    ? "/icons/show.png"
                                    : "/icons/hide.png"
                                } className="hide-icon" />
                            </div> 
                        </div>
                        <div className="form-group mt-3">
                            <Link href="/forgot-password" className="auth-link">Forgot password?</Link>
                        </div>
                        <div className="form-group mt-3">
                            <button 
                                type="button" 
                                onClick={login} 
                                disabled={isLoading}
                                className={`auth-btn ${buttonState === 'loading' ? 'loading' : ''} ${buttonState === 'success' ? 'success' : ''}`}
                            >
                                {buttonState === 'loading' ? 'Logging in...' : buttonState === 'success' ? 'Success!' : 'Login'}
                            </button>
                        </div>
                        <div className="form-group mt-3 text-center">
                            <span className="text-sm">Don't have an account? </span>&nbsp;&nbsp;
                            <Link href="/signup" className="auth-link">Sign up</Link>
                        </div>
                        <div className="form-group mt-1 text-center">
                            <Link href="/collaborator/login" className="auth-link">Switch to collaborator login</Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
