"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInPage } from "@/components/SignInPage";

export default function Home() {
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-screen w-screen items-center justify-center bg-gradient-to-b from-white to-gray-50">
          <Loader2 className="w-6 h-6 animate-spin text-casuro-dark" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignInPage />
      </Unauthenticated>
      <Authenticated>
        <SignedInScreen />
      </Authenticated>
    </>
  );
}

function SignedInScreen() {
  const { signOut } = useAuthActions();
  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-gradient-to-b from-white to-gray-50">
      <div className="w-full max-w-sm mx-auto px-6 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-casuro-dark">
          You&apos;re signed in
        </h1>
        <Button
          onClick={() => void signOut()}
          className="h-11 bg-casuro-dark text-white hover:bg-casuro-dark/90 rounded-full px-6"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
