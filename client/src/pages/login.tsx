import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import materializedLogo from "@assets/MTRLZD_Logo_white_transparent.png";
import { Eye, EyeOff } from "lucide-react";
import type { CurrentUser } from "@/hooks/useCurrentUser";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

const ROLE_ROUTES: Record<string, string> = {
  creator: "/creator",
  brand: "/brand",
  affiliate: "/affiliate",
};

export default function Login() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/auth/login", data),
    onSuccess: async (res: any) => {
      const user: CurrentUser = await res.json();
      queryClient.setQueryData(["/api/auth/me"], user);
      // Back to whatever they were doing, if the guard sent them here.
      const next = new URLSearchParams(window.location.search).get("next");
      const destination = next && next.startsWith("/") && !next.startsWith("//")
        ? next
        : ROLE_ROUTES[user.role] ?? "/creator";
      navigate(destination);
    },
    onError: async (err: any) => {
      let message = err?.message || "Login failed. Please check your email and password.";
      try {
        const jsonPart = message.substring(message.indexOf("{"));
        if (jsonPart) {
          const parsed = JSON.parse(jsonPart);
          if (parsed.error) message = parsed.error;
          if (parsed.needsVerification) {
            message = "Please verify your email first. Check your inbox for the verification link.";
          }
        }
      } catch {}
      toast({ title: "Login failed", description: message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#202120] px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src={materializedLogo} alt="Materialized" style={{ height: 40, width: "auto" }} />
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          {/* Say why they are here. Arriving at a bare login screen mid-task
              reads as the previous page having broken. */}
          {new URLSearchParams(window.location.search).get("reason") === "expired" ? (
            <>
              <h1 className="text-xl font-semibold text-foreground mb-1">Your session expired</h1>
              <p className="text-sm text-muted-foreground mb-6" data-testid="text-login-expired">
                Sign in again and we'll take you back to what you were doing.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-foreground mb-1">Welcome back</h1>
              <p className="text-sm text-muted-foreground mb-6">Sign in to your Materialized account</p>
            </>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => loginMutation.mutate(d))} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        data-testid="input-login-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          data-testid="input-login-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
                data-testid="button-login-submit"
              >
                {loginMutation.isPending ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </Form>

          <div className="mt-4 text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-[#1351aa] hover:underline"
              data-testid="link-login-forgot-password"
            >
              Forgot password?
            </Link>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link href="/register" className="text-primary hover:underline font-medium">
                Create one
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
