"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedOTPInput } from "@/components/ui/smoothui/animated-o-t-p-input";

type Mode = "phone" | "code";

export function SignInPage() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<Mode>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "phone") {
        await signIn("phone", { phone });
        setMessage(`Calling ${phone} with your code`);
        setMode("code");
      } else {
        await signIn("phone", { phone, code });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(
        mode === "code" && msg.toLowerCase().includes("code")
          ? "Incorrect code. Please try again."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-gradient-to-b from-white to-gray-50 pb-20">
      <div className="w-full max-w-sm mx-auto px-6">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-casuro-dark">Matcha</h1>
          <p className="text-sm text-casuro-dark/60 mt-1">
            Powered by casuro.ai
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-medium text-casuro-dark text-center mb-6">
            {mode === "phone"
              ? "Sign in to your account"
              : "Verify your phone number"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "phone" && (
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm text-casuro-dark">
                  Phone number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  required
                  disabled={loading}
                  className="h-10 rounded-lg"
                />
              </div>
            )}

            {mode === "code" && (
              <div className="space-y-4">
                <p className="text-sm text-casuro-dark/60 text-center">
                  You&apos;ll get a call at <strong>{phone}</strong> with a
                  6-digit code
                </p>
                <div className="flex justify-center">
                  <AnimatedOTPInput
                    value={code}
                    onChange={setCode}
                    onComplete={(val) => setCode(val)}
                    maxLength={6}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 text-center">{error}</p>
            )}
            {message && mode === "phone" && (
              <p className="text-sm text-green-600 text-center">{message}</p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-casuro-dark text-white hover:bg-casuro-dark/90 rounded-full"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {loading
                ? "Please wait..."
                : mode === "phone"
                  ? "Send code"
                  : "Verify"}
            </Button>
          </form>

          <div className="mt-5 text-center space-y-2">
            {mode === "code" && (
              <button
                onClick={() => {
                  setMode("phone");
                  setError(null);
                  setMessage(null);
                  setCode("");
                }}
                className="text-xs text-casuro-dark/60 hover:text-casuro-dark"
              >
                Back to phone number
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
