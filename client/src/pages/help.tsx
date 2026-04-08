import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search,
  HelpCircle,
  BookOpen,
  Video,
  MessageCircle,
  Mail,
  ExternalLink,
  Upload,
  Link2,
  BarChart3,
  Code,
} from "lucide-react";

const faqs = [
  {
    question: "How do I upload a video?",
    answer: "Click the 'Upload Video' button on the dashboard or My Campaigns page. You can drag and drop your video file or click to browse. Supported formats include MP4, MOV, and WebM up to 500MB.",
  },
  {
    question: "How does product detection work?",
    answer: "After you upload a video and select the brands featured in it, our AI analyzes video frames to detect products from the brand's inventory. Detected products appear in an interactive carousel on your published video.",
  },
  {
    question: "How do I earn commission?",
    answer: "You earn commission when viewers click on products in your video carousel and make purchases. Your commission rate is shown in the Affiliate Links section of your dashboard. Payouts are processed monthly.",
  },
  {
    question: "What is the 'Refer a Brand' feature?",
    answer: "If a brand you want to feature isn't on our platform, you can refer them. Fill out the referral form with their PR contact information, and we'll send them an invitation. When they join, you earn bonus commissions on their products.",
  },
  {
    question: "How do I embed videos on my website?",
    answer: "Open any published video's menu and click 'Get Embed Code'. Copy the iframe code and paste it into your website's HTML. We provide both standard and responsive embed options.",
  },
  {
    question: "What analytics are available?",
    answer: "Track views, clicks, click-through rate (CTR), and revenue for each video. The Analytics page shows trends over time, geographic breakdown, and device types. You can also filter and sort performance data.",
  },
];

const quickLinks = [
  { icon: Upload, label: "Upload Video", href: "/creator/my-videos" },
  { icon: Link2, label: "Affiliate Links", href: "/creator" },
  { icon: BarChart3, label: "Analytics", href: "/creator/analytics" },
  { icon: Code, label: "Embed Codes", href: "/creator/my-videos" },
];

export default function Help() {
  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Help Center</h1>
        <p className="text-muted-foreground mt-1">
          Find answers and get support for your video commerce journey
        </p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          placeholder="Search help articles..."
          className="pl-12 h-12 text-base"
          data-testid="input-search-help"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {quickLinks.map((link) => (
          <Card key={link.label} className="hover-elevate cursor-pointer">
            <CardContent className="p-4 text-center">
              <div className="h-10 w-10 mx-auto rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                <link.icon className="h-5 w-5 text-primary" />
              </div>
              <p className="font-medium text-sm">{link.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Frequently Asked Questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`faq-${index}`}>
                <AccordionTrigger className="text-left">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="h-12 w-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-4">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Documentation</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Browse detailed guides and tutorials
            </p>
            <Button variant="outline" className="gap-2 rounded-full">
              View Docs
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 text-center">
            <div className="h-12 w-12 mx-auto rounded-xl bg-chart-2/10 flex items-center justify-center mb-4">
              <Video className="h-6 w-6 text-chart-2" />
            </div>
            <h3 className="font-semibold mb-2">Video Tutorials</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Watch step-by-step walkthroughs
            </p>
            <Button variant="outline" className="gap-2 rounded-full">
              Watch Videos
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 text-center">
            <div className="h-12 w-12 mx-auto rounded-xl bg-green-500/10 flex items-center justify-center mb-4">
              <MessageCircle className="h-6 w-6 text-green-500" />
            </div>
            <h3 className="font-semibold mb-2">Live Support</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Chat with our support team
            </p>
            <Button variant="outline" className="gap-2 rounded-full">
              Start Chat
              <MessageCircle className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-to-r from-primary/10 to-chart-2/10 border-0">
        <CardContent className="p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="h-16 w-16 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-semibold text-lg">Still need help?</h3>
            <p className="text-muted-foreground mt-1">
              Can't find what you're looking for? Our support team is here to help.
            </p>
          </div>
          <Button className="rounded-full gap-2">
            <Mail className="h-4 w-4" />
            Contact Support
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
