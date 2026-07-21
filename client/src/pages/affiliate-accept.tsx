import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import materializedLogo from "@assets/MATERIALIZED_full_logo_1773352270197.png";
import { Eye, EyeOff } from "lucide-react";

const schema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type FormData = z.infer<typeof schema>;

export default function AffiliateAccept() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState<"form" | "success" | "error">(token ? "form" : "error");
  const [errorMessage, setErrorMessage] = useState(
    token ? "" : "This invitation link is invalid. Please ask for a new one."
  );

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const acceptMutation = useMutation({
    mutationFn: (data: FormData) =>
      apiRequest("POST", `/api/affiliates/accept/${token}`, { password: data.password }),
    onSuccess: () => setStatus("success"),
    onError: async (err: any) => {
      let message = err?.message || "This invitation link is invalid or has already been used.";
      try {
        const jsonPart = message.substring(message.indexOf("{"));
        if (jsonPart) {
          const parsed = JSON.parse(jsonPart);
          if (parsed.error) message = parsed.error;
        }
      } catch {}
      setErrorMessage(message);
      setStatus("error");
    },
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#202120] px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src={materializedLogo} alt="Materialized" style={{ height: 40, width: "auto" }} />
        </div>

        {status === "form" && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
            <h1 className="text-xl font-semibold text-foreground mb-1">Join as a publisher</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Set a password to accept your invitation and start earning commission.
            </p>

            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => acceptMutation.mutate(d))} className="space-y-4">
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
                            placeholder="At least 6 characters"
                            autoComplete="new-password"
                            data-testid="input-accept-password"
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

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showConfirm ? "text" : "password"}
                            placeholder="Re-enter your password"
                            autoComplete="new-password"
                            data-testid="input-accept-confirm"
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirm((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                  disabled={acceptMutation.isPending}
                  data-testid="button-accept-submit"
                >
                  {acceptMutation.isPending ? "Creating your account…" : "Accept & create account"}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
                Already have an account? Sign in
              </Link>
            </div>
          </div>
        )}

        {status === "success" && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-foreground mb-2">You're in!</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Your publisher account is ready. Sign in to start reposting videos and earning commission.
            </p>
            <Button className="w-full" onClick={() => navigate("/login")} data-testid="button-accept-success-login">
              Go to Login
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-foreground mb-2">Invitation invalid</h1>
            <p className="text-sm text-muted-foreground mb-6">{errorMessage}</p>
            <Button variant="outline" className="w-full" onClick={() => navigate("/login")} data-testid="button-accept-goto-login">
              Go to Login
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
