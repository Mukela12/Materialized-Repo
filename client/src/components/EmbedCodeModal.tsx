import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Code, Monitor, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Video } from "@shared/schema";

interface EmbedCodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: Video | null;
}

export function EmbedCodeModal({ open, onOpenChange, video }: EmbedCodeModalProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  if (!video) return null;

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  
  const iframeCode = `<iframe 
  src="${baseUrl}/embed/${video.id}?utm=${video.utmCode}" 
  width="100%" 
  height="450" 
  frameborder="0" 
  allowfullscreen
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
></iframe>`;

  const responsiveCode = `<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
  <iframe 
    src="${baseUrl}/embed/${video.id}?utm=${video.utmCode}" 
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" 
    frameborder="0" 
    allowfullscreen
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  ></iframe>
</div>`;

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast({
      title: "Copied!",
      description: "Embed code copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Code className="h-5 w-5" />
            Embed Code
          </DialogTitle>
          <DialogDescription>
            Add this video with product carousel to your website
          </DialogDescription>
        </DialogHeader>

        <Card className="bg-muted/50 border-0">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-24 h-14 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                {video.thumbnailUrl ? (
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-chart-2/20" />
                )}
              </div>
              <div>
                <p className="font-medium">{video.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">
                    UTM: {video.utmCode?.slice(0, 8)}...
                  </Badge>
                  <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-xs">
                    {video.status}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="standard" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="standard" className="gap-2">
              <Monitor className="h-4 w-4" />
              Standard
            </TabsTrigger>
            <TabsTrigger value="responsive" className="gap-2">
              <Smartphone className="h-4 w-4" />
              Responsive
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="standard" className="space-y-4">
            <div className="relative">
              <Textarea
                value={iframeCode}
                readOnly
                className="min-h-[150px] font-mono text-sm bg-muted/50"
                data-testid="textarea-embed-code-standard"
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 gap-1"
                onClick={() => copyCode(iframeCode)}
                data-testid="button-copy-embed-standard"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Fixed 450px height. Best for sidebars or fixed-size containers.
            </p>
          </TabsContent>
          
          <TabsContent value="responsive" className="space-y-4">
            <div className="relative">
              <Textarea
                value={responsiveCode}
                readOnly
                className="min-h-[200px] font-mono text-sm bg-muted/50"
                data-testid="textarea-embed-code-responsive"
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 gap-1"
                onClick={() => copyCode(responsiveCode)}
                data-testid="button-copy-embed-responsive"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Maintains 16:9 aspect ratio and scales with container width. Best for responsive layouts.
            </p>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-3 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
