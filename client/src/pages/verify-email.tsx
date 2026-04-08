import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import materializedLogo from "@assets/MATERIALIZED_full_logo_1773352270197.png";

const ROLE_ROUTES: Record<string, string> = {
  creator: "/creator",
  brand: "/brand",
  affiliate: "/affiliate",
};

export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState("");
  const [userRole, setUserRole] = useState("creator");

  const verifyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/verify-email", { token }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      queryClient.setQueryData(["/api/auth/me"], data);
      setUserRole(data.role || "creator");
      setStatus("success");
    },
    onError: async (err: any) => {
      let message = "Verification failed. The link may have expired.";
      try {
        const body = await err.response?.json();
        if (body?.error) message = body.error;
      } catch {}
      setErrorMessage(message);
      setStatus("error");
    },
  });

  useEffect(() => {
    if (token) {
      verifyMutation.mutate();
    }
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#202120] px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src={materializedLogo} alt="Materialized" style={{ height: 40, width: "auto" }} />
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl text-center">
          {status === "verifying" && (
            <>
              <div className="w-16 h-16 rounded-full bg-[#677A67]/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
                <svg className="w-8 h-8 text-[#677A67]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-foreground mb-2">Verifying your email...</h1>
              <p className="text-sm text-muted-foreground">Please wait a moment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-foreground mb-2">Email verified!</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Your account is now active. You're automatically logged in.
              </p>
              <Button
                className="w-full bg-[#677A67] hover:bg-[#556655] text-white"
                onClick={() => navigate(ROLE_ROUTES[userRole] || "/creator")}
              >
                Go to Dashboard
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-foreground mb-2">Verification failed</h1>
              <p className="text-sm text-muted-foreground mb-6">{errorMessage}</p>
              <Link href="/register">
                <Button variant="outline" className="w-full">
                  Try registering again
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
