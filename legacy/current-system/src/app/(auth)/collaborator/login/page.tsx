"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import '../../../../../global.css';

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [buttonState, setButtonState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  const login = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) return;
    setErrorMessage("");

    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setIsLoading(true);
    setButtonState('loading');

    try {
      const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://alphakolect.com';
      const apiUrl = BASE_URL.endsWith('/api') ? `${BASE_URL}/collaborator/login` : `${BASE_URL}/api/collaborator/login`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed. Please check your credentials.');
      }

      setButtonState('success');

      // Store token & session details in localStorage
      if (data.token) {
        localStorage.setItem('merchantToken', data.token);
        localStorage.setItem('collaboratorToken', data.token);
        if (data.collaborator) {
          localStorage.setItem('user', JSON.stringify(data.collaborator));
          localStorage.setItem('userType', 'collaborator');
          if (data.collaborator.permissions) {
            localStorage.setItem('staffPermissions', JSON.stringify(data.collaborator.permissions));
          } else {
            localStorage.removeItem('staffPermissions');
          }
        }
      }

      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    } catch (err: any) {
      setButtonState('idle');
      setIsLoading(false);
      setErrorMessage(err.message || 'Login failed');
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
              <img src="/images/logo.png" alt="AlphaKolect Logo" />
            </div>
            <div className="card-body mt-3">
              <h1 className="card-title text-center text-black">Collaborator Login</h1>
              <p className="card-description text-center mt-2">Login to your account to get started</p>
              <form onSubmit={login}>
                <div className="form-group">
                  <label htmlFor="email" className="form-label">Email</label>
                  <input
                    type="email"
                    id="email"
                    className="input-field"
                    placeholder="johndoe@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="form-group mt-3">
                  <label className="form-label">Password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="input-field"
                    placeholder="********"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <div
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="flex justify-end icon-up"
                  >
                    <img
                      src={showPassword ? "/icons/show.png" : "/icons/hide.png"}
                      className="hide-icon"
                      alt={showPassword ? "Hide password" : "Show password"}
                    />
                  </div>
                </div>
                {errorMessage && (
                  <div className="form-group mt-2">
                    <p style={{ color: '#e53e3e', fontSize: '14px', textAlign: 'center' }}>
                      {errorMessage}
                    </p>
                  </div>
                )}
                <div className="form-group mt-3">
                  <Link href="/collaborator/forgot-password" className="auth-link">
                    Forgot password?
                  </Link>
                </div>
                <div className="form-group mt-3">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className={`auth-btn ${buttonState === 'loading' ? 'loading' : ''} ${buttonState === 'success' ? 'success' : ''}`}
                  >
                    {buttonState === 'loading' ? 'Logging in...' : buttonState === 'success' ? 'Success!' : 'Login'}
                  </button>
                </div>
                <div className="form-group mt-3 text-center">
                  <span className="text-sm">Don&apos;t have an account? </span>&nbsp;&nbsp;
                  <Link href="/signup" className="auth-link">Sign up</Link>
                </div>
                <div className="form-group mt-1 text-center">
                  <Link href="/login" className="auth-link">Switch to merchant login</Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
