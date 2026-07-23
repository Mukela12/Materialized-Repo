import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import materializedLogo from "@assets/MTRLZD_Logo_white_transparent.png";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPassword() {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const forgotMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/auth/forgot-password", data),
    onSuccess: (_res, variables) => {
      setSubmittedEmail(variables.email);
      setSent(true);
    },
    onError: async (err: any) => {
      let message = err?.message || "Something went wrong. Please try again.";
      try {
        const jsonPart = message.substring(message.indexOf("{"));
        if (jsonPart) {
          const parsed = JSON.parse(jsonPart);
          if (parsed.error) message = parsed.error;
        }
      } catch {}
      toast({ title: "Request failed", description: message, variant: "destructive" });
    },
  });

  if (sent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#202120] px-4">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8">
            <img src={materializedLogo} alt="Materialized" style={{ height: 40, width: "auto" }} />
          </div>
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl text-center">
            <div className="w-16 h-16 rounded-full bg-[#677A67]/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#677A67]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-foreground mb-2">Check your email</h1>
            <p className="text-sm text-muted-foreground mb-6">
              If an account exists for <strong className="text-foreground">{submittedEmail}</strong>,
              we've sent a link to reset your password. The link expires in 1 hour.
            </p>
            <Link href="/login" className="text-sm text-[#677A67] hover:underline" data-testid="link-forgot-back-login">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#202120] px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src={materializedLogo} alt="Materialized" style={{ height: 40, width: "auto" }} />
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          <h1 className="text-xl font-semibold text-foreground mb-1">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your email and we'll send you a reset link.
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => forgotMutation.mutate(d))} className="space-y-4">
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
                        data-testid="input-forgot-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={forgotMutation.isPending}
                data-testid="button-forgot-submit"
              >
                {forgotMutation.isPending ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </Form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Remember your password?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Sign in
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
