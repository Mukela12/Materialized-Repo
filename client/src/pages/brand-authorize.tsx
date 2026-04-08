import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Loader2, ShieldCheck, Video, AlertCircle } from "lucide-react";

interface OutreachDetails {
  id: string;
  brandName: string;
  prContactName: string;
  videoTitle: string | null;
  videoUrl: string | null;
  creatorMessage: string | null;
  status: string;
}

export default function BrandAuthorize() {
  const [, params] = useRoute("/brand-authorize/:token");
  const token = params?.token ?? "";
  const [authorized, setAuthorized] = useState(false);

  const { data: outreach, isLoading, error } = useQuery<OutreachDetails>({
    queryKey: ["/api/brand-outreach/authorize", token],
    queryFn: () => fetch(`/api/brand-outreach/authorize/${token}`).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Not found");
      }
      return r.json();
    }),
    enabled: !!token,
    retry: false,
  });

  const authorizeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/brand-outreach/authorize/${token}`, {}),
    onSuccess: () => setAuthorized(true),
  });

  const firstName = outreach?.prContactName?.split(" ")[0] ?? "there";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#202120] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#677A67] animate-spin" />
      </div>
    );
  }

  if (error || !outreach) {
    const isUsed = error?.message?.includes("already been used") || error?.message?.includes("already used");
    return (
      <div className="min-h-screen bg-[#202120] flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-[#2a2a2a] border-white/10">
          <CardContent className="p-8 text-center">
            {isUsed ? (
              <>
                <CheckCircle className="w-12 h-12 text-[#677A67] mx-auto mb-4" />
                <h1 className="text-white text-xl font-bold mb-2">Already Authorised</h1>
                <p className="text-white/60 text-sm">
                  This link has already been used. Please check your email for the Materialized Brand Agreement.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                <h1 className="text-white text-xl font-bold mb-2">Link Not Found</h1>
                <p className="text-white/60 text-sm">
                  This authorisation link is invalid or has expired.
                </p>
              </>
            )}
            <p className="text-white/30 text-xs mt-6">
              Questions? Visit <a href="https://join.materialized.com" className="text-[#677A67]">join.materialized.com</a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authorized) {
    return (
      <div className="min-h-screen bg-[#202120] flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-[#2a2a2a] border-white/10">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[#677A67]/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-[#677A67]" />
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">You're all set, {firstName}!</h1>
            <p className="text-white/70 text-sm leading-relaxed mb-6">
              Thank you for authorising this collaboration. We've sent you an email with the
              <strong className="text-white"> Materialized Brand Agreement</strong> (via DocuSign).
              Once signed, you'll receive the embeddable code to publish the shoppable video on your website.
            </p>
            <div className="bg-[#677A67]/10 border border-[#677A67]/20 rounded-lg p-4 mb-6">
              <p className="text-[#677A67] text-sm font-medium">Next steps:</p>
              <ol className="text-white/60 text-sm mt-2 space-y-1 text-left list-decimal list-inside">
                <li>Check your inbox for the DocuSign agreement</li>
                <li>Review and sign the brand commission terms</li>
                <li>Receive your embeddable shoppable video code</li>
              </ol>
            </div>
            <p className="text-white/30 text-xs">
              Want full Brand dashboard access?{" "}
              <a href="/brand" className="text-[#677A67] hover:underline">Subscribe to Materialized →</a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#202120] flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center mb-2">
          <div className="text-white font-bold text-xl tracking-widest opacity-80">MATERIALIZED</div>
          <div className="text-white/40 text-xs tracking-widest mt-1">VIDEO COMMERCE</div>
        </div>

        <Card className="bg-[#2a2a2a] border-white/10">
          <CardContent className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-[#677A67]/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-[#677A67]" />
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider">Brand Collaboration Request</p>
                <p className="text-white font-semibold">{outreach.brandName}</p>
              </div>
            </div>

            <h1 className="text-white text-2xl font-bold mb-4 leading-snug">
              Hey {firstName}, a creator wants to make their video shoppable with your products
            </h1>

            <p className="text-white/70 text-sm leading-relaxed mb-5">
              A creator on Materialized would like to tag <strong className="text-white">{outreach.brandName}</strong> products
              in their video, turning it into a fully shoppable experience that earns commissions for both parties.
            </p>

            {outreach.creatorMessage && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-5">
                <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Message from the creator</p>
                <p className="text-white/80 text-sm italic leading-relaxed">"{outreach.creatorMessage}"</p>
              </div>
            )}

            {outreach.videoTitle && (
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
                <Video className="w-5 h-5 text-[#677A67] shrink-0" />
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider">Video</p>
                  <p className="text-white text-sm font-medium">{outreach.videoTitle}</p>
                </div>
              </div>
            )}

            <div className="bg-[#677A67]/10 border border-[#677A67]/20 rounded-lg p-4 mb-6 text-sm text-white/70 leading-relaxed">
              <p className="font-medium text-[#677A67] mb-1">What happens when you click below:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>We'll send you a <strong className="text-white">Materialized Brand Agreement</strong> via DocuSign</li>
                <li>The agreement covers video marketplace commission terms</li>
                <li>After signing, you receive the <strong className="text-white">embeddable code</strong> for your website</li>
              </ol>
            </div>

            <Button
              className="w-full rounded-full py-6 text-base font-bold bg-[#677A67] hover:bg-[#556655] text-white"
              onClick={() => authorizeMutation.mutate()}
              disabled={authorizeMutation.isPending}
              data-testid="button-brand-authorize"
            >
              {authorizeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                "Let's Do This!"
              )}
            </Button>

            {authorizeMutation.isError && (
              <p className="text-red-400 text-sm text-center mt-3">
                Something went wrong. Please try again or contact us at{" "}
                <a href="mailto:hello@join.materialized.com" className="underline">hello@join.materialized.com</a>
              </p>
            )}

            <p className="text-white/30 text-xs text-center mt-4">
              A separate Materialized Brand subscription is required for full dashboard access.{" "}
              <a href="/brand" className="text-[#677A67]">Learn more →</a>
            </p>
          </CardContent>
        </Card>

        <p className="text-white/20 text-xs text-center">
          © 2026 Materialized. If you weren't expecting this, you can safely ignore this page.
        </p>
      </div>
    </div>
  );
}
